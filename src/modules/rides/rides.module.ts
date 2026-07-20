import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    JwtModule.register({}),
    RealtimeModule,
    PaymentsModule,
  ],
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
