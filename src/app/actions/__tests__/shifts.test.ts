import { describe, it, expect } from 'vitest';
import { closeShift, openShift } from '../shifts';
import crypto from 'crypto';
import db from '@/lib/db';

describe('Shift Actions', () => {
  it('Z-reading vatable_sales includes delivery_fee under Option A', async () => {
    const userId = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system) VALUES (?, 'cashier_vat', 'VAT Cashier', 'Cashier', 'hash', 'salt', 1, 0)`).run(userId);

    const openRes = await openShift(5000);
    if (!openRes.success) throw new Error("OPEN_FAILED: " + openRes.error);
    const shiftId = openRes.data;
    const txDate = new Date().toISOString();

    // Insert a taxable transaction with delivery fee
    // subtotal=11200, deliveryFee=1120, discount=0 → totalAmount=12320
    // tax = round((11200+1120)/1.12*0.12) = round(1320) = 1320
    // vatable net = 12320 - 1320 = 11000
    const transactionId = crypto.randomUUID();
    db.prepare(`INSERT INTO transactions (id, cashier_id, date, subtotal, tax, delivery_fee, discount, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status) 
      VALUES (?, 'system-daemon', ?, 11200, 1320, 1120, 0, 12320, 12320, 0, 'Paid', 'Cash', 'N/A')`).run(transactionId, txDate);

    const res = await closeShift(shiftId, 5000);
    expect(res.success).toBe(true);

    const zReading = db.prepare("SELECT * FROM shift_z_readings WHERE shift_id = ?").get(shiftId) as {
      gross_sales: number;
      vat_collected: number;
      vatable_sales: number;
      exempt_sales: number;
    };

    expect(zReading.gross_sales).toBe(12320);
    expect(zReading.vat_collected).toBe(1320);
    expect(zReading.vatable_sales).toBe(11000);  // 12320 - 1320
    // vatable + vat collected = 11000 + 1320 = 12320 = totalAmount
  });

  it('calculates Z-Reading and discrepancy correctly', async () => {
    // Need a user to open a shift
    const userId = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system) VALUES (?, 'cashier1', 'Cashier', 'Cashier', 'hash', 'salt', 1, 0)`).run(userId);

    const openRes = await openShift(5000); // 5000 centavos float
    if (!openRes.success) throw new Error("OPEN_FAILED: " + openRes.error);
    const shiftId = openRes.data;

    // Mock some sales using transactions manually
    const transactionId = crypto.randomUUID();
    db.prepare(`INSERT INTO transactions (id, cashier_id, date, subtotal, tax, total_amount, amount_paid, payment_status, payment_method, delivery_status) 
      VALUES (?, 'system-daemon', ?, 1000, 100, 1100, 1100, 'Paid', 'Cash', 'N/A')`).run(transactionId, new Date().toISOString());
    
    // Expected cash: 5000 + 1100 = 6100.
    const res = await closeShift(shiftId, 6000);
    if (!res.success) throw new Error(res.error);
    const { discrepancy } = res.data!;

    expect(discrepancy).toBe(-100); // 6000 actual - 6100 expected
  });
});
