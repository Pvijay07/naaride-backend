import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { DatabaseModule } from '../database/database.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [DatabaseModule, RealtimeModule],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
