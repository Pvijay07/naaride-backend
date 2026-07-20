import { Controller, Get, Post, Body, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { CaptainService } from './captain.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';

class RequestPayoutDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  amount: number;
}

@Controller('api/v1/captain')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('captain')
export class CaptainController {
  constructor(private captainService: CaptainService) {}

  @Get('earnings')
  async getEarnings(@Req() req: any) {
    const data = await this.captainService.getEarnings(req.user.userId);
    return { success: true, data };
  }

  @Post('payout/request')
  @HttpCode(HttpStatus.OK)
  async requestPayout(@Req() req: any, @Body() body: RequestPayoutDto) {
    const data = await this.captainService.requestPayout(req.user.userId, body.amount);
    return { success: true, data };
  }
}
