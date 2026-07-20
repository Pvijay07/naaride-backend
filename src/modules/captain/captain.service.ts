import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CaptainService {
  constructor(private dbService: DatabaseService) {}

  async getEarnings(captainId: string) {
    // 1. Calculate Balance
    const balQuery = `
      SELECT COALESCE(SUM(amount), 0.00)::numeric(8,2) as balance 
      FROM wallet_transactions 
      WHERE captain_id = $1;
    `;
    const balRes = await this.dbService.query(balQuery, [captainId]);
    const balance = parseFloat(balRes.rows[0].balance);

    // 2. Fetch Transactions
    const txQuery = `
      SELECT id, amount, type, description, created_at 
      FROM wallet_transactions 
      WHERE captain_id = $1 
      ORDER BY created_at DESC;
    `;
    const txRes = await this.dbService.query(txQuery, [captainId]);

    return {
      balance,
      transactions: txRes.rows,
    };
  }

  async requestPayout(captainId: string, amount: number) {
    if (amount <= 0) {
      throw new BadRequestException({
        success: false,
        error: { code: 'INVALID_AMOUNT', message: 'Payout amount must be greater than zero' },
      });
    }

    return this.dbService.transaction(async (client) => {
      // 1. Check current balance with a write lock
      const balQuery = `
        SELECT COALESCE(SUM(amount), 0.00)::numeric(8,2) as balance 
        FROM wallet_transactions 
        WHERE captain_id = $1;
      `;
      const balRes = await client.query(balQuery, [captainId]);
      const balance = parseFloat(balRes.rows[0].balance);

      if (balance < amount) {
        throw new BadRequestException({
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient wallet balance for this payout' },
        });
      }

      // 2. Insert debit wallet transaction
      const insertTx = `
        INSERT INTO wallet_transactions (captain_id, amount, type, description)
        VALUES ($1, $2, 'payout', $3)
        RETURNING id, amount, created_at;
      `;
      const txRes = await client.query(insertTx, [
        captainId,
        -amount,
        `Requested payout of INR ${amount.toFixed(2)}`
      ]);

      return txRes.rows[0];
    });
  }
}
