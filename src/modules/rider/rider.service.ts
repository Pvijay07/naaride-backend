import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class RiderService {
  constructor(private dbService: DatabaseService) {}

  async getProfile(userId: string) {
    const q = 'SELECT id, phone, name, email, created_at FROM users WHERE id = $1';
    const res = await this.dbService.query(q, [userId]);
    if (res.rows.length === 0) {
      throw new NotFoundException({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Rider profile not found' },
      });
    }
    return res.rows[0];
  }

  async updateProfile(userId: string, name: string, email: string) {
    const q = `
      UPDATE users 
      SET name = COALESCE($2, name), 
          email = COALESCE($3, email),
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, phone, name, email, updated_at;
    `;
    const res = await this.dbService.query(q, [userId, name, email]);
    if (res.rows.length === 0) {
      throw new NotFoundException({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'Rider profile not found' },
      });
    }
    return res.rows[0];
  }
}
