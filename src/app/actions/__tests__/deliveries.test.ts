import { describe, it, expect, beforeEach } from 'vitest';
import db from '@/lib/db';
import { dispatchDelivery } from '../deliveries';
import { getMlekSecret, setMlekSecret } from '@/lib/mlek';
import crypto from 'crypto';
import { runMigrations } from '@/lib/db';

describe('Deliveries API', () => {
  let transactionId: string;
  let itemId: string;

  beforeEach(async () => {
    await runMigrations();

    // Clear relevant tables
    db.prepare('DELETE FROM delivery_items').run();
    db.prepare('DELETE FROM deliveries').run();
    db.prepare('DELETE FROM transaction_items').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM inventory').run();
    db.prepare('DELETE FROM system_audit_logs').run();
    db.prepare('DELETE FROM shifts').run();
    db.prepare('DELETE FROM users').run();

    setMlekSecret(crypto.randomBytes(32));

    const mlekHex = getMlekSecret().toString('hex');
    db.prepare(`INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system) VALUES ('user_1', 'admin', 'Admin', 'Admin', 'hash', 'salt', 1, 0)`).run();
    db.prepare(`INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system) VALUES ('system-daemon', 'daemon', 'Daemon', 'Admin', 'hash', 'salt', 1, 1)`).run();
    db.prepare(`INSERT INTO shifts (id, cashier_id, opened_at, opening_float, status) VALUES ('shift_1', 'user_1', CURRENT_TIMESTAMP, 0, 'Open')`).run();

    transactionId = crypto.randomUUID();
    itemId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active)
      VALUES (?, 'Nails', 'Hardware', 'kg', 100000, 5000, 8000, 7000, 10000, 1)
    `).run(itemId);

    db.prepare(`
      INSERT INTO transactions (id, cashier_id, date, subtotal, tax, delivery_fee, discount, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status)
      VALUES (?, 'user_1', CURRENT_TIMESTAMP, 8000, 0, 0, 0, 8000, 8000, 0, 'Paid', 'Cash', 'Pending')
    `).run(transactionId);

    db.prepare(`
      INSERT INTO transaction_items (id, transaction_id, item_id, quantity, unit_used, unit_price, unit_cost, total_price, quantity_returned)
      VALUES (?, ?, ?, 5000, 'kg', 8000, 5000, 40000, 0)
    `).run(crypto.randomUUID(), transactionId, itemId);
  });

  it('successfully dispatches a delivery with valid quantities', async () => {
    const deliveryId = await dispatchDelivery(transactionId, 'John Doe', 'ABC-1234', [
      { itemId, quantityDelivered: 2000 }
    ]);
    expect(deliveryId).toBeDefined();

    const delivery = db.prepare('SELECT status FROM deliveries WHERE id = ?').get(deliveryId) as { status: string };
    expect(delivery.status).toBe('Dispatched');

    const tx = db.prepare('SELECT delivery_status FROM transactions WHERE id = ?').get(transactionId) as { delivery_status: string };
    expect(tx.delivery_status).toBe('Partially Delivered');
  });

  it('rejects dispatching more than remaining quantity', async () => {
    await expect(dispatchDelivery(transactionId, 'John Doe', 'ABC-1234', [
      { itemId, quantityDelivered: 6000 }
    ])).rejects.toThrow(/DISPATCH_EXCEEDS_REMAINING/);
  });
});
