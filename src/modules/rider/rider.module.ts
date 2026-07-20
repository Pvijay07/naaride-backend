import { Module } from '@nestjs/common';
import { RiderController } from './rider.controller';
import { RiderService } from './rider.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [JwtModule.register({})],
  controllers: [RiderController],
  providers: [RiderService],
})
export class RiderModule {}
