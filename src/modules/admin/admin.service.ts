import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminService {
  private redisClient: Redis;
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private configService: ConfigService,
    private dbService: DatabaseService,
  ) {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379/0';
    this.redisClient = new Redis(redisUrl);
    this.redisClient.on('error', (err) => {
      this.logger.error('Redis client error', err);
    });
  }

  async getDashboardMetrics() {
    // 1. Rides today
    const ridesQuery = "SELECT COUNT(*)::int as count FROM rides WHERE created_at >= CURRENT_DATE;";
    const ridesRes = await this.dbService.query(ridesQuery);
    const ridesToday = ridesRes.rows[0].count;

    // 2. GMV Today
    const gmvQuery = "SELECT COALESCE(SUM(final_fare), 0.00)::numeric(8,2) as gmv FROM rides WHERE status = 'completed' AND updated_at >= CURRENT_DATE;";
    const gmvRes = await this.dbService.query(gmvQuery);
    const gmv = parseFloat(gmvRes.rows[0].gmv);

    // 3. Active Captains (online in Redis)
    let activeCaptains = 0;
    try {
      activeCaptains = await this.redisClient.zcard('captains:live');
    } catch {
      const activeDb = "SELECT COUNT(*) FROM captains WHERE updated_at >= NOW() - INTERVAL '15 minutes';";
      const dbRes = await this.dbService.query(activeDb);
      activeCaptains = parseInt(dbRes.rows[0].count, 10);
    }

    // 4. Completion & Cancellation Rates
    const ratesQuery = `
      SELECT 
        COUNT(*)::float as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::float as completed,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::float as cancelled
      FROM rides 
      WHERE created_at >= CURRENT_DATE;
    `;
    const ratesRes = await this.dbService.query(ratesQuery);
    const row = ratesRes.rows[0];
    const total = row.total || 0;
    
    const completionRate = total > 0 ? parseFloat(((row.completed / total) * 100).toFixed(1)) : 100.0;
    const cancellationRate = total > 0 ? parseFloat(((row.cancelled / total) * 100).toFixed(1)) : 0.0;

    return {
      ridesToday,
      gmv,
      activeCaptains,
      completionRate,
      cancellationRate,
      chartData: [
        { date: 'Today', rides: ridesToday }
      ]
    };
  }

  async updateCaptainKyc(captainId: string, status: 'approved' | 'rejected', reason?: string) {
    const q = `
      UPDATE captains 
      SET kyc_status = $2, 
          kyc_rejection_reason = COALESCE($3, kyc_rejection_reason),
          updated_at = NOW() 
      WHERE id = $1
      RETURNING id, name, kyc_status;
    `;
    const res = await this.dbService.query(q, [captainId, status, reason || null]);
    return res.rows[0];
  }

  // Pricing rules CRUD
  async updatePricingRule(id: string, base: number, perKm: number, perMin: number, min: number, cancelFee: number) {
    const q = `
      UPDATE pricing_rules 
      SET base_fare = $2, per_km_rate = $3, per_min_rate = $4, min_fare = $5, cancellation_fee = $6, updated_at = NOW() 
      WHERE id = $1
      RETURNING *;
    `;
    const res = await this.dbService.query(q, [id, base, perKm, perMin, min, cancelFee]);
    return res.rows[0];
  }

  // Promo codes CRUD
  async createPromoCode(code: string, pct: number, maxDiscount: number) {
    const q = `
      INSERT INTO promo_codes (code, discount_percentage, max_discount, active) 
      VALUES ($1, $2, $3, TRUE) 
      RETURNING *;
    `;
    const res = await this.dbService.query(q, [code, pct, maxDiscount]);
    return res.rows[0];
  }

  async togglePromoCode(id: string, active: boolean) {
    const q = 'UPDATE promo_codes SET active = $2 WHERE id = $1 RETURNING *;';
    const res = await this.dbService.query(q, [id, active]);
    return res.rows[0];
  }
}
