import { Controller, Get, Post, Body, Param, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { RidesService } from './rides.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { IsNotEmpty, IsString, IsEnum, IsNumber, IsOptional, ValidateNested, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class LocationDto {
  @IsNotEmpty()
  @IsNumber()
  lat: number;

  @IsNotEmpty()
  @IsNumber()
  lng: number;
}

class EstimateFareDto {
  @IsNotEmpty()
  @IsString()
  city: string;

  @IsNotEmpty()
  @IsEnum(['bike', 'auto', 'cab'])
  vehicle_type: 'bike' | 'auto' | 'cab';

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => LocationDto)
  pickup: LocationDto;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => LocationDto)
  drop: LocationDto;
}

class RequestRideDto {
  @IsNotEmpty()
  @IsEnum(['bike', 'auto', 'cab'])
  vehicle_type: 'bike' | 'auto' | 'cab';

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => LocationDto)
  pickup: LocationDto;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => LocationDto)
  drop: LocationDto;

  @IsNotEmpty()
  @IsNumber()
  estimated_fare: number;

  @IsNotEmpty()
  @IsEnum(['cash', 'online'])
  payment_mode: 'cash' | 'online';
}

class RateRideDto {
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(5)
  score: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RidesController {
  constructor(private ridesService: RidesService) {}

  @Post('rides/estimate')
  @HttpCode(HttpStatus.OK)
  async estimateFare(@Body() body: EstimateFareDto) {
    const data = await this.ridesService.estimateFare(body.city, body.vehicle_type, body.pickup, body.drop);
    return { success: true, data };
  }

  @Post('rides/request')
  @Roles('rider')
  async requestRide(@Req() req: any, @Body() body: RequestRideDto) {
    const data = await this.ridesService.requestRide(
      req.user.userId,
      body.vehicle_type,
      body.pickup,
      body.drop,
      body.estimated_fare,
      body.payment_mode,
    );
    return { success: true, data };
  }

  @Get('rides/history')
  async getHistory(@Req() req: any) {
    const data = await this.ridesService.getHistory(req.user.userId, req.user.role);
    return { success: true, data };
  }

  @Get('rides/:id')
  async getRideDetails(@Param('id') id: string) {
    const data = await this.ridesService.getRideDetails(id);
    return { success: true, data };
  }

  @Post('rides/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelRide(@Req() req: any, @Param('id') id: string) {
    const data = await this.ridesService.cancelRide(id, req.user.userId, req.user.role);
    return { success: true, data };
  }

  @Post('rides/:id/rate')
  @HttpCode(HttpStatus.OK)
  async rateRide(@Req() req: any, @Param('id') id: string, @Body() body: RateRideDto) {
    const data = await this.ridesService.rateRide(id, req.user.userId, body.score, body.comment);
    return { success: true, data };
  }

  @Post('rides/:id/accept')
  @Roles('captain')
  @HttpCode(HttpStatus.OK)
  async acceptRide(@Req() req: any, @Param('id') id: string) {
    const data = await this.ridesService.acceptRide(id, req.user.userId);
    return { success: true, data };
  }

  @Post('rides/:id/arrived')
  @Roles('captain')
  @HttpCode(HttpStatus.OK)
  async arriveAtPickup(@Req() req: any, @Param('id') id: string) {
    const data = await this.ridesService.arriveAtPickup(id, req.user.userId);
    return { success: true, data };
  }

  @Post('rides/:id/start')
  @Roles('captain')
  @HttpCode(HttpStatus.OK)
  async startRide(@Req() req: any, @Param('id') id: string, @Body() body: { otp: string }) {
    const data = await this.ridesService.startRide(id, req.user.userId, body.otp);
    return { success: true, data };
  }

  @Post('rides/:id/complete')
  @Roles('captain')
  @HttpCode(HttpStatus.OK)
  async completeRide(@Req() req: any, @Param('id') id: string) {
    const data = await this.ridesService.completeRide(id, req.user.userId);
    return { success: true, data };
  }
}
