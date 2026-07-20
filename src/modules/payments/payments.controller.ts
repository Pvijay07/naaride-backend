import { Controller, Post, Body, Headers, HttpCode, HttpStatus, BadRequestException, Req } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('api/v1/webhooks')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('razorpay')
  @HttpCode(HttpStatus.OK)
  async handleRazorpayWebhook(
    @Req() req: any,
    @Body() body: any,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing webhook signature header');
    }

    // Reconstruct body string if rawBody is not configured
    const stringBody = typeof req.body === 'string' ? req.body : JSON.stringify(body);

    const isValid = await this.paymentsService.verifyWebhookSignature(stringBody, signature);
    if (!isValid) {
      throw new BadRequestException('Invalid webhook signature verification');
    }

    const { event, payload } = body;
    return this.paymentsService.handlePaymentWebhook(event, payload);
  }
}
