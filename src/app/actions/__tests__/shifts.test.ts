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
    db.prepare(`INSERT INTO transactions (id, cashier_id, date, subtotal, tax, total_amount, amount_paid, payment_status, payment_method, delivery_status) 
      VALUES (?, 'system-daemon', CURRENT_TIMESTAMP, 1000, 100, 1100, 1100, 'Paid', 'Cash', 'N/A')`).run(transactionId);
    
    // Expected cash: 5000 + 1100 = 6100.
    const { discrepancy } = await closeShift(shiftId, 6000);

    expect(discrepancy).toBe(-100); // 6000 actual - 6100 expected
  });
});
