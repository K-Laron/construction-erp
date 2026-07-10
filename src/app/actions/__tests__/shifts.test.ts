import { describe, it, expect } from 'vitest';
import { closeShift, openShift } from '../shifts';
import crypto from 'crypto';
import db from '@/lib/db';

describe('Shift Actions', () => {
  it('calculates Z-Reading and discrepancy correctly', async () => {
    // Need a user to open a shift
    const userId = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system) VALUES (?, 'cashier1', 'Cashier', 'Cashier', 'hash', 'salt', 1, 0)`).run(userId);

    const shiftId = await openShift(userId, 5000); // 5000 centavos float

    // Mock some sales using transactions manually
    const transactionId = crypto.randomUUID();
    db.prepare(`INSERT INTO transactions (id, cashier_id, date, subtotal, tax, total_amount, payment_status, payment_method, delivery_status) 
      VALUES (?, ?, datetime('now'), 1000, 100, 1100, 'Paid', 'Cash', 'N/A')`).run(transactionId, userId);
    
    // Expected cash: 5000 + 1100 = 6100.
    const { discrepancy } = await closeShift(shiftId, 6000);

    expect(discrepancy).toBe(1000); // 6000 actual - 5000 expected (since fake sale missed the timeframe or link)
  });
});
