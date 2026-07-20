import { Module } from '@nestjs/common';
import { CaptainController } from './captain.controller';
import { CaptainService } from './captain.service';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [JwtModule.register({})],
  controllers: [CaptainController],
  providers: [CaptainService],
})
export class CaptainModule {}
