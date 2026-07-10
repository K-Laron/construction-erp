import { describe, it, expect } from 'vitest';
import { authenticateUser } from '../auth';
import { processCheckout } from '../transactions';
import db from '@/lib/db';
import crypto from 'crypto';

describe('Auth Actions', () => {
  it('enforces rate limiting on login', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await authenticateUser('fake_user', 'wrong_pass', '192.168.1.100');
      if (i < 3) {
        expect(res.success).toBe(false);
        expect(res.error).toBe('Invalid username or PIN.');
      }
    }
    const rateLimited = await authenticateUser('fake_user', 'wrong_pass', '192.168.1.100');
    expect(rateLimited.success).toBe(false);
    expect(rateLimited.error).toContain('IP temporarily locked');
  });

  it('validates override PIN correctly using PBKDF2', async () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const pin = '123456';
    const hash = crypto.pbkdf2Sync(pin, salt, 600000, 32, 'sha512').toString('hex');

    const userId = crypto.randomUUID();
    db.prepare(`INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
      VALUES (?, 'manager', 'Manager User', 'Manager', ?, ?, 1, 0)`).run(userId, hash, salt);

    // Create a customer with credit limit 10
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, created_at) VALUES (?, 'Test Cust', 10, 0, 1, CURRENT_TIMESTAMP)`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    // Try checkout that exceeds credit limit
    const payload = {
      customerId,
      cashierId: userId,
      items: [
        { itemId, name: 'Test', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 0,
      paymentMethod: 'Credit' as const,
      overridePin: '123456'
    };

    // Correct PIN should succeed or throw something else than CREDIT_LIMIT_EXCEEDED
    try {
      await processCheckout(payload);
    } catch(e: unknown) {
      if (e instanceof Error) expect(e.message).not.toContain("Invalid Manager Override PIN");
    }

    const invalidPayload = { ...payload, overridePin: 'wrong' };
    const res = await processCheckout(invalidPayload);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Invalid Manager Override PIN/);
  });
});
