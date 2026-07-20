import { Controller, Get, Put, Post, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { IsNotEmpty, IsString, IsEnum, IsNumber, IsOptional, IsBoolean } from 'class-validator';

class UpdateKycDto {
  @IsNotEmpty()
  @IsEnum(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  reason?: string;
}

class UpdatePricingDto {
  @IsNotEmpty()
  @IsNumber()
  base_fare: number;

  @IsNotEmpty()
  @IsNumber()
  per_km_rate: number;

  @IsNotEmpty()
  @IsNumber()
  per_min_rate: number;

  @IsNotEmpty()
  @IsNumber()
  min_fare: number;

  @IsNotEmpty()
  @IsNumber()
  cancellation_fee: number;
}

class CreatePromoDto {
  @IsNotEmpty()
  @IsString()
  code: string;

  @IsNotEmpty()
  @IsNumber()
  discount_percentage: number;

  @IsNotEmpty()
  @IsNumber()
  max_discount: number;
}

class TogglePromoDto {
  @IsNotEmpty()
  @IsBoolean()
  active: boolean;
}

@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'ops', 'finance', 'support')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('dashboard/metrics')
  async getMetrics() {
    const data = await this.adminService.getDashboardMetrics();
    return { success: true, data };
  }

  @Put('captains/:id/kyc')
  @Roles('super_admin', 'ops')
  async updateKyc(@Param('id') id: string, @Body() body: UpdateKycDto) {
    const data = await this.adminService.updateCaptainKyc(id, body.status, body.reason);
    return { success: true, data };
  }

  @Put('pricing-rules/:id')
  @Roles('super_admin', 'ops', 'finance')
  async updatePricing(@Param('id') id: string, @Body() body: UpdatePricingDto) {
    const data = await this.adminService.updatePricingRule(
      id,
      body.base_fare,
      body.per_km_rate,
      body.per_min_rate,
      body.min_fare,
      body.cancellation_fee
    );
    return { success: true, data };
  }

  @Post('promo-codes')
  @Roles('super_admin', 'ops')
  async createPromo(@Body() body: CreatePromoDto) {
    const data = await this.adminService.createPromoCode(
      body.code,
      body.discount_percentage,
      body.max_discount
    );
    return { success: true, data };
  }

  @Put('promo-codes/:id/toggle')
  @Roles('super_admin', 'ops')
  async togglePromo(@Param('id') id: string, @Body() body: TogglePromoDto) {
    const data = await this.adminService.togglePromoCode(id, body.active);
    return { success: true, data };
  }
}
