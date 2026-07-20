import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { BroadcasterService } from './broadcaster.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway, BroadcasterService],
  exports: [BroadcasterService],
})
export class RealtimeModule {}
