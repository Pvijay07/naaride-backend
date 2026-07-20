import { Injectable, UnauthorizedException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { SmsService } from '../sms/sms.service';
import Redis from 'ioredis';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private redisClient: Redis;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
    private dbService: DatabaseService,
    private smsService: SmsService,
  ) {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379/0';
    this.redisClient = new Redis(redisUrl);
    this.redisClient.on('error', (err) => {
      this.logger.error('Redis client error', err);
    });
  }

  async sendOTP(phone: string, role: 'rider' | 'captain'): Promise<{ message: string }> {
    // Rate limit check: 3 requests per phone per 10 minutes
    const limitKey = `otp_limit:${phone}`;
    const otpCount = await this.redisClient.get(limitKey);

    if (otpCount && parseInt(otpCount, 10) >= 3) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Rate limit exceeded. Try again after 10 minutes.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Increment and set expiry if key is new
    if (!otpCount) {
      await this.redisClient.set(limitKey, '1', 'EX', 600);
    } else {
      await this.redisClient.incr(limitKey);
    }

    // Generate 6 digit code
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in Redis (5 min TTL)
    const otpKey = `otp:${role}:${phone}`;
    await this.redisClient.set(otpKey, otp, 'EX', 300);

    // Trigger mock SMS send
    await this.smsService.sendOTP(phone, otp);

    return { message: 'OTP sent successfully' };
  }

  async verifyOTP(phone: string, role: 'rider' | 'captain', code: string): Promise<{ access_token: string; refresh_token: string }> {
    const otpKey = `otp:${role}:${phone}`;
    const storedOtp = await this.redisClient.get(otpKey);

    if (!storedOtp) {
      throw new UnauthorizedException({
        success: false,
        error: { code: 'INVALID_OTP', message: 'OTP has expired or is invalid' },
      });
    }

    if (storedOtp !== code) {
      throw new UnauthorizedException({
        success: false,
        error: { code: 'INVALID_OTP', message: 'Incorrect OTP' },
      });
    }

    // Upsert database profile
    let entityId: string;

    if (role === 'rider') {
      const q = `
        INSERT INTO users (phone, name, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (phone) DO UPDATE SET updated_at = NOW()
        RETURNING id;
      `;
      const res = await this.dbService.query(q, [phone, 'Rider']);
      entityId = res.rows[0].id;
    } else {
      const q = `
        INSERT INTO captains (phone, name, vehicle_type, kyc_status, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (phone) DO UPDATE SET updated_at = NOW()
        RETURNING id;
      `;
      const res = await this.dbService.query(q, [phone, 'Captain', 'bike', 'approved']);
      entityId = res.rows[0].id;
    }

    // Clear OTP tokens
    await this.redisClient.del(otpKey);
    await this.redisClient.del(`otp_limit:${phone}`);

    return this.generateTokenPair(entityId, role);
  }

  async refreshTokens(refreshToken: string): Promise<{ access_token: string; refresh_token: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      return this.generateTokenPair(payload.user_id, payload.role);
    } catch (err) {
      throw new UnauthorizedException({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired refresh token' },
      });
    }
  }

  async adminLogin(email: string, pass: string): Promise<{ access_token: string; refresh_token: string }> {
    const q = 'SELECT id, email, password_hash, role FROM admin_users WHERE email = $1';
    const res = await this.dbService.query(q, [email]);

    if (res.rows.length === 0) {
      throw new UnauthorizedException({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      });
    }

    const admin = res.rows[0];
    // Replace PHP-specific bcrypt prefix ($2y$) with standard bcrypt prefix ($2a$) if present
    const hash = admin.password_hash.startsWith('$2y$')
      ? admin.password_hash.replace(/^\$2y\$/, '$2a$')
      : admin.password_hash;

    const match = await bcrypt.compare(pass, hash);
    if (!match) {
      throw new UnauthorizedException({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' },
      });
    }

    return this.generateTokenPair(admin.id, admin.role);
  }

  private async generateTokenPair(userId: string, role: string) {
    const secret = this.configService.get<string>('JWT_SECRET');

    const accessToken = this.jwtService.sign(
      { user_id: userId, role },
      { secret, expiresIn: '2h' },
    );

    const refreshToken = this.jwtService.sign(
      { user_id: userId, role },
      { secret, expiresIn: '30d' },
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }
}
