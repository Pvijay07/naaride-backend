import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './modules/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { SmsModule } from './modules/sms/sms.module';
import { RiderModule } from './modules/rider/rider.module';
import { RidesModule } from './modules/rides/rides.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { MatchingModule } from './modules/matching/matching.module';
import { CaptainModule } from './modules/captain/captain.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    SmsModule,
    AuthModule,
    RiderModule,
    RidesModule,
    RealtimeModule,
    MatchingModule,
    CaptainModule,
    PaymentsModule,
    AdminModule,
  ],
})
export class AppModule {}
