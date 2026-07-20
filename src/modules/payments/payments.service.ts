import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import * as crypto from 'crypto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private configService: ConfigService,
    private dbService: DatabaseService,
  ) {}

  async createRazorpayOrder(rideId: string, amountINR: number): Promise<string> {
    const keyId = this.configService.get<string>('RAZORPAY_KEY_ID') || 'rzp_test_key';
    const keySecret = this.configService.get<string>('RAZORPAY_SECRET') || 'rzp_test_secret';

    const amountInPaise = Math.round(amountINR * 100);

    try {
      // Mock / Stub Razorpay API Call for local dev
      this.logger.log(`[RAZORPAY MOCK] Creating order for Ride ${rideId} of INR ${amountINR} (${amountInPaise} paise)`);
      const mockOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;

      // Insert record into payments table
      const insertPay = `
        INSERT INTO payments (ride_id, amount, status, razorpay_order_id)
        VALUES ($1, $2, 'pending', $3);
      `;
      await this.dbService.query(insertPay, [rideId, amountINR, mockOrderId]);

      return mockOrderId;
    } catch (err) {
      this.logger.error('Failed to create Razorpay payment order', err);
      throw new BadRequestException('Payment order generation failed');
    }
  }

  async verifyWebhookSignature(rawBody: string, signature: string): Promise<boolean> {
    const secret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET') || 'webhook_secret';
    
    const hash = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    return hash === signature;
  }

  async handlePaymentWebhook(event: string, payload: any) {
    if (event !== 'payment.captured') {
      this.logger.debug(`Ignoring unhandled webhook event: ${event}`);
      return { status: 'ignored' };
    }

    const orderId = payload.payment.entity.order_id;
    const paymentId = payload.payment.entity.id;

    this.logger.log(`Processing payment.captured for order ${orderId} (Payment ID: ${paymentId})`);

    // Update databases inside transaction
    await this.dbService.transaction(async (client) => {
      // 1. Update payments record
      const updatePayment = `
        UPDATE payments 
        SET status = 'captured', razorpay_payment_id = $2
        WHERE razorpay_order_id = $1
        RETURNING ride_id, amount;
      `;
      const payRes = await client.query(updatePayment, [orderId, paymentId]);

      if (payRes.rows.length === 0) {
        this.logger.warn(`No payment record found mapping to order ID ${orderId}`);
        return;
      }

      const { ride_id } = payRes.rows[0];

      // 2. Update ride record payment status
      const updateRide = `
        UPDATE rides 
        SET payment_status = 'captured', updated_at = NOW() 
        WHERE id = $1;
      `;
      await client.query(updateRide, [ride_id]);
      this.logger.log(`Ride ${ride_id} payment status set to captured`);
    });

    return { status: 'success' };
  }
}
