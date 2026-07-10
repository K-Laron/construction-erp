import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'crypto';
import db from '@/lib/db';
import { getSession } from '@/lib/session';
import { createUser, authenticateUser, checkManagerRole } from '../auth';
import { processCheckout } from '../transactions';

describe('RBAC Enforcement', () => {
  const cashierId = crypto.randomUUID();
  const managerId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const cashierPin = '123456';
  const managerPin = '654321';

  beforeAll(() => {
    // Create test users with different roles
    const makeUser = (id: string, username: string, name: string, role: string, pin: string) => {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(pin, salt, 600000, 32, 'sha512').toString('hex');
      db.prepare(
        `INSERT OR IGNORE INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0)`
      ).run(id, username, name, role, hash, salt);
    };
    makeUser(cashierId, 'cashier1', 'Cashier One', 'Cashier', cashierPin);
    makeUser(managerId, 'manager1', 'Manager One', 'Manager', managerPin);
    makeUser(adminId, 'admin1', 'Admin One', 'Admin', '999999');

    // Seed a test product
    db.prepare(
      `INSERT OR IGNORE INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active)
       VALUES (?, 'Test Concurrency Item', 'Tools', 'pc', 3000, 500, 1000, 900, 500, 1)`
    ).run(itemId);
  });

  it('allows Admin to create a user', async () => {
    vi.mocked(getSession).mockResolvedValueOnce({ userId: adminId, role: 'Admin', save: vi.fn() } as any);
    const res = await createUser(adminId, 'newguy', 'New Guy', 'Cashier', '123456');
    expect(res.success).toBe(true);
  });

  it('denies Cashier from creating a user (RBAC_DENIED)', async () => {
    vi.mocked(getSession).mockResolvedValueOnce({ userId: cashierId, role: 'Cashier', save: vi.fn() } as any);
    const res = await createUser(cashierId, 'shouldfail', 'Should Fail', 'Cashier', '123456');
    expect(res.success).toBe(false);
    expect(res.error).toContain('RBAC_DENIED');
  });

  it('denies Viewer role from creating a user (RBAC_DENIED)', async () => {
    const viewerId = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync('000000', salt, 600000, 32, 'sha512').toString('hex');
    db.prepare(
      `INSERT OR IGNORE INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
       VALUES (?, 'viewer1', 'Viewer One', 'Viewer', ?, ?, 1, 0)`
    ).run(viewerId, hash, salt);

    vi.mocked(getSession).mockResolvedValueOnce({ userId: viewerId, role: 'Viewer', save: vi.fn() } as any);
    const res = await createUser(viewerId, 'shouldfail2', 'Should Fail 2', 'Cashier', '123456');
    expect(res.success).toBe(false);
    expect(res.error).toContain('RBAC_DENIED');
  });

  it('correctly authenticates a Cashier user', async () => {
    const res = await authenticateUser('cashier1', cashierPin);
    expect(res.success).toBe(true);
    expect(res.user?.role).toBe('Cashier');
  });

  it('rejects authentication with wrong PIN', async () => {
    const res = await authenticateUser('cashier1', 'wrongpin');
    expect(res.success).toBe(false);
  });

  it('checkManagerRole throws for Cashier user', async () => {
    vi.mocked(getSession).mockResolvedValueOnce({ userId: cashierId, role: 'Cashier', save: vi.fn() } as any);
    await expect(checkManagerRole()).rejects.toThrow('RBAC_DENIED');
  });

  it('checkManagerRole returns userId for Manager user', async () => {
    vi.mocked(getSession).mockResolvedValueOnce({ userId: managerId, role: 'Manager', save: vi.fn() } as any);
    const result = await checkManagerRole();
    expect(result).toBe(managerId);
  });
});

describe('Concurrency Safety', () => {
  beforeAll(() => {
    // Reset stock to a known quantity
    db.prepare('UPDATE inventory SET stock_quantity = 3000 WHERE id = ?').run('item-uuid-concurrency');
    const concurrencyItemId = crypto.randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active)
       VALUES (?, 'Concurrency Test Item', 'Tools', 'pc', 3000, 500, 1000, 900, 500, 1)`
    ).run(concurrencyItemId);
  });

  it('handles parallel checkouts without overselling stock', async () => {
    // Find the concurrency item
    const item = db.prepare("SELECT id, stock_quantity FROM inventory WHERE name = 'Concurrency Test Item'").get() as { id: string; stock_quantity: number } | undefined;
    if (!item) return; // skip if item not found
    const targetItemId = item.id;

    // Ensure stock is exactly 3 units (3000 millicounts)
    db.prepare('UPDATE inventory SET stock_quantity = 3000 WHERE id = ?').run(targetItemId);

    const adminSalt = crypto.randomBytes(16).toString('hex');
    const adminHash = crypto.pbkdf2Sync('adminpin', adminSalt, 600000, 32, 'sha512').toString('hex');
    const adminId = crypto.randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
       VALUES (?, 'concurrency_admin', 'Concurrency Admin', 'Admin', ?, ?, 1, 0)`
    ).run(adminId, adminHash, adminSalt);

    vi.mocked(getSession).mockResolvedValue({ userId: adminId, role: 'Admin', save: vi.fn() } as any);

    // Launch 5 parallel checkouts, each trying to buy 1 unit (1000 millicounts)
    // Only 3 should succeed since stock is 3 units
    const payload = {
      customerId: null as string | null,
      cashierId: adminId,
      items: [
        { itemId: targetItemId, name: 'Concurrency Test Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 1000,
      paymentMethod: 'Cash' as const
    };

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => processCheckout(payload))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

    // At most 3 should succeed (stock was 3 units)
    expect(succeeded).toBeLessThanOrEqual(3);

    // Remaining should fail or report insufficient stock
    const failed = results.filter(r => r.status === 'fulfilled' && !r.value.success);
    expect(failed.length).toBeGreaterThanOrEqual(2);

    // Final stock should be 0
    const finalItem = db.prepare("SELECT stock_quantity FROM inventory WHERE id = ?").get(targetItemId) as { stock_quantity: number };
    expect(finalItem.stock_quantity).toBe(0);
  });
});
