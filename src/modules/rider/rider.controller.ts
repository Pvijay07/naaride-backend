import { Controller, Get, Put, Body, UseGuards, Req } from '@nestjs/common';
import { RiderService } from './rider.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { IsString, IsEmail, IsOptional } from 'class-validator';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

@Controller('api/v1/rider')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('rider')
export class RiderController {
  constructor(private riderService: RiderService) {}

  @Get('profile')
  async getProfile(@Req() req: any) {
    const data = await this.riderService.getProfile(req.user.userId);
    return { success: true, data };
  }

  @Put('profile')
  async updateProfile(@Req() req: any, @Body() body: UpdateProfileDto) {
    const data = await this.riderService.updateProfile(req.user.userId, body.name, body.email);
    return { success: true, data };
  }
}
