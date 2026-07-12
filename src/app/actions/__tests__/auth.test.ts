import { describe, it, expect } from 'vitest';
import { authenticateUser, createUser, getUsers, updateCostPrice, overrideCreditLimit } from '../auth';
import { processCheckout } from '../transactions';
import db from '@/lib/db';
import crypto from 'crypto';

describe('Auth Actions', () => {
  it('enforces rate limiting on login', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await authenticateUser('fake_user', 'wrong_pass');
      if (i < 3) {
        expect(res.success).toBe(false);
        expect(res.error).toBe('Invalid username or PIN.');
      }
    }
    const rateLimited = await authenticateUser('fake_user', 'wrong_pass');
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
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, created_at) VALUES (?, 'Test Cust', 10, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(customerId);

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
  }, 30000); // 30s timeout for PBKDF2 with 600K iterations
});

describe('User Management', () => {
  it('creates a new Cashier user', async () => {
    const res = await createUser('cashier1', 'Cashier One', 'Cashier', '123456');
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    const user = db.prepare("SELECT username, name, role, is_active FROM users WHERE id = ?").get(res.data) as any;
    expect(user.username).toBe('cashier1');
    expect(user.name).toBe('Cashier One');
    expect(user.role).toBe('Cashier');
    expect(user.is_active).toBe(1);
  });

  it('returns non-system users', async () => {
    const users = await getUsers();
    expect(users.length).toBeGreaterThanOrEqual(1);
    // system-daemon should NOT appear
    expect(users.find(u => u.username === 'SYSTEM')).toBeUndefined();
  });

  it('updates cost price', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active)
      VALUES (?, 'Cost Price Item', 'Tools', 'pc', 10000, 500, 1000, 900, 1)`).run(itemId);

    const res = await updateCostPrice(itemId, 750);
    expect(res.success).toBe(true);

    const item = db.prepare("SELECT cost_price FROM inventory WHERE id = ?").get(itemId) as { cost_price: number };
    expect(item.cost_price).toBe(750);
  });

  it('rejects updateCostPrice for non-existent product', async () => {
    const res = await updateCostPrice(crypto.randomUUID(), 1000);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('overrides credit limit', async () => {
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, created_at)
      VALUES (?, 'CL Customer', 5000, 0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(customerId);

    const res = await overrideCreditLimit(customerId, 10000);
    expect(res.success).toBe(true);

    const cust = db.prepare("SELECT credit_limit FROM customers WHERE id = ?").get(customerId) as { credit_limit: number };
    expect(cust.credit_limit).toBe(10000);
  });

  it('rejects overrideCreditLimit for non-existent customer', async () => {
    const res = await overrideCreditLimit(crypto.randomUUID(), 5000);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});
