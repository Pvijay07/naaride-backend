import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  async sendOTP(phone: string, code: string): Promise<void> {
    this.logger.log(`[SMS MOCK] Sending 6-digit OTP code ${code} to phone ${phone}`);
  }
}
