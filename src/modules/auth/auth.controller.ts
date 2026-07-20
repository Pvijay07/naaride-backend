import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { IsNotEmpty, IsString, IsEnum, IsEmail } from 'class-validator';

class SendOtpDto {
  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @IsEnum(['rider', 'captain'])
  role: 'rider' | 'captain';
}

class VerifyOtpDto {
  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsNotEmpty()
  @IsEnum(['rider', 'captain'])
  role: 'rider' | 'captain';

  @IsNotEmpty()
  @IsString()
  otp: string;
}

class RefreshDto {
  @IsNotEmpty()
  @IsString()
  refresh_token: string;
}

class AdminLoginDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  password: string;
}

@Controller('api/v1')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('auth/otp/send')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() body: SendOtpDto) {
    const data = await this.authService.sendOTP(body.phone, body.role);
    return { success: true, data };
  }

  @Post('auth/otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() body: VerifyOtpDto) {
    const data = await this.authService.verifyOTP(body.phone, body.role, body.otp);
    return { success: true, data };
  }

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshDto) {
    const data = await this.authService.refreshTokens(body.refresh_token);
    return { success: true, data };
  }

  @Post('admin/auth/login')
  @HttpCode(HttpStatus.OK)
  async adminLogin(@Body() body: AdminLoginDto) {
    const data = await this.authService.adminLogin(body.email, body.password);
    return { success: true, data };
  }
}
