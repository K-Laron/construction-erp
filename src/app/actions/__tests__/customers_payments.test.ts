import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import db from '@/lib/db';
import { processCheckout } from '../transactions';
import { recordPayment, createCustomer, getCustomers, deactivateCustomer, verifyAllCustomersIntegrity } from '../customers';

function sumAccount(accountId: string, type: 'DEBIT' | 'CREDIT') {
  return (db.prepare(
    `SELECT COALESCE(SUM(amount),0) as total FROM journal_lines WHERE account_id = ? AND type = ?`
  ).get(accountId, type) as { total: number }).total;
}

describe('Customer Payment Invoice Allocation (FIFO)', () => {

  it('payment reduces oldest invoice first', async () => {
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, is_vat_exempt, created_at)
      VALUES (?, 'FIFO Cust 1', 10000, 0, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active)
      VALUES (?, 'FIFO Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    // Sale A: total 1000
    const saleA = await processCheckout({
      customerId,
      cashierId: 'system-daemon',
      items: [{ itemId, name: 'FIFO Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }],
      subtotal: 1000, tax: 0, deliveryFee: 0, discount: 0, totalAmount: 1000, amountPaid: 0, paymentMethod: 'Credit'
    });
    expect(saleA.success).toBe(true);

    // Sale B: total 2000
    const saleB = await processCheckout({
      customerId,
      cashierId: 'system-daemon',
      items: [{ itemId, name: 'FIFO Item', quantity: 2000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 2000 }],
      subtotal: 2000, tax: 0, deliveryFee: 0, discount: 0, totalAmount: 2000, amountPaid: 0, paymentMethod: 'Credit'
    });
    expect(saleB.success).toBe(true);

    // Check balance
    const cust = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId) as { current_balance: number };
    expect(cust.current_balance).toBe(3000);

    // Get transaction IDs ordered by date
    const txns = db.prepare("SELECT id, balance_due FROM transactions WHERE customer_id = ? ORDER BY date ASC, id ASC").all(customerId) as { id: string; balance_due: number }[];
    expect(txns.length).toBe(2);
    const oldestId = txns[0].id;
    const newestId = txns[1].id;
    expect(txns[0].balance_due).toBe(1000);
    expect(txns[1].balance_due).toBe(2000);

    // Clear GL to isolate payment entries
    db.prepare('DELETE FROM journal_lines').run();
    db.prepare('DELETE FROM journal_entries').run();

    // Pay 1000
    const payRes = await recordPayment(customerId, 1000, 'Partial collection');
    expect(payRes.success).toBe(true);

    // Customer balance went down
    const custAfter = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId) as { current_balance: number };
    expect(custAfter.current_balance).toBe(2000);

    // Oldest invoice fully paid
    const oldestAfter = db.prepare("SELECT balance_due, payment_status, amount_paid FROM transactions WHERE id = ?").get(oldestId) as { balance_due: number; payment_status: string; amount_paid: number };
    expect(oldestAfter.balance_due).toBe(0);
    expect(oldestAfter.payment_status).toBe('Paid');
    expect(oldestAfter.amount_paid).toBe(1000);

    // Newest invoice untouched
    const newestAfter = db.prepare("SELECT balance_due, payment_status, amount_paid FROM transactions WHERE id = ?").get(newestId) as { balance_due: number; payment_status: string; amount_paid: number };
    expect(newestAfter.balance_due).toBe(2000);
    expect(newestAfter.payment_status).toBe('Unpaid');
    expect(newestAfter.amount_paid).toBe(0);

    // G/L: cash DEBIT 1000, AR CREDIT 1000
    expect(sumAccount('acc-cash', 'DEBIT')).toBe(1000);
    expect(sumAccount('acc-ar', 'CREDIT')).toBe(1000);
  });

  it('payment spanning two invoices', async () => {
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, is_vat_exempt, created_at)
      VALUES (?, 'FIFO Cust 2', 10000, 0, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active)
      VALUES (?, 'FIFO Item 2', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    // Sale A: total 1000
    await processCheckout({
      customerId, cashierId: 'system-daemon',
      items: [{ itemId, name: 'FIFO Item 2', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }],
      subtotal: 1000, tax: 0, deliveryFee: 0, discount: 0, totalAmount: 1000, amountPaid: 0, paymentMethod: 'Credit'
    });

    // Sale B: total 2000
    await processCheckout({
      customerId, cashierId: 'system-daemon',
      items: [{ itemId, name: 'FIFO Item 2', quantity: 2000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 2000 }],
      subtotal: 2000, tax: 0, deliveryFee: 0, discount: 0, totalAmount: 2000, amountPaid: 0, paymentMethod: 'Credit'
    });

    const txns = db.prepare("SELECT id, balance_due FROM transactions WHERE customer_id = ? ORDER BY date ASC, id ASC").all(customerId) as { id: string; balance_due: number }[];
    expect(txns.length).toBe(2);
    const oldestId = txns[0].id;

    db.prepare('DELETE FROM journal_lines').run();
    db.prepare('DELETE FROM journal_entries').run();

    // Pay 2500 — should cover oldest fully (1000) and partial newest (1500)
    const payRes = await recordPayment(customerId, 2500, 'Big payment');
    expect(payRes.success).toBe(true);

    const custAfter = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId) as { current_balance: number };
    expect(custAfter.current_balance).toBe(500);

    const oldestAfter = db.prepare("SELECT balance_due, payment_status FROM transactions WHERE id = ?").get(oldestId) as { balance_due: number; payment_status: string };
    expect(oldestAfter.balance_due).toBe(0);
    expect(oldestAfter.payment_status).toBe('Paid');

    const newestAfter = db.prepare("SELECT balance_due, payment_status FROM transactions WHERE id != ? AND customer_id = ? ORDER BY date ASC").get(oldestId, customerId) as { balance_due: number; payment_status: string };
    expect(newestAfter.balance_due).toBe(500);
    expect(newestAfter.payment_status).toBe('Partial');
  });

  it('allows overpayment to create a credit balance', async () => {
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, is_vat_exempt, created_at)
      VALUES (?, 'FIFO Cust 3', 10000, 500, 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`).run(customerId);

    // Balance is 500, pay 501
    const res = await recordPayment(customerId, 501, 'Overpay attempt');
    expect(res.success).toBe(true);

    const cust = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId) as { current_balance: number };
    expect(cust.current_balance).toBe(-1); // 500 - 501 = -1
  });
});

describe('Customer CRUD', () => {
  it('creates a new customer', async () => {
    const res = await createCustomer('Test New', '09170000000', '123 Test St', 5000, 'Retail', 0);
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    const cust = db.prepare("SELECT name, credit_limit, price_tier, is_vat_exempt, is_active FROM customers WHERE id = ?").get(res.data) as any;
    expect(cust.name).toBe('Test New');
    expect(cust.credit_limit).toBe(5000);
    expect(cust.price_tier).toBe('Retail');
    expect(cust.is_vat_exempt).toBe(0);
    expect(cust.is_active).toBe(1);
  });

  it('creates a wholesale vat-exempt customer', async () => {
    const res = await createCustomer('Wholesale Cust', null, null, 10000, 'Wholesale', 1);
    expect(res.success).toBe(true);

    const cust = db.prepare("SELECT price_tier, is_vat_exempt FROM customers WHERE id = ?").get(res.data) as any;
    expect(cust.price_tier).toBe('Wholesale');
    expect(cust.is_vat_exempt).toBe(1);
  });

  it('rejects customer with empty name', async () => {
    const res = await createCustomer('', null, null, 0, 'Retail', 0);
    expect(res.success).toBe(false);
  });

  it('returns all active customers', async () => {
    const pre = await getCustomers();
    const beforeCount = pre.length;

    await createCustomer('List Test', null, null, 0, 'Retail', 0);
    await createCustomer('Another List', null, null, 0, 'Retail', 0);

    const post = await getCustomers();
    expect(post.length).toBe(beforeCount + 2);
  });

  it('soft-deletes a customer', async () => {
    const createRes = await createCustomer('To Delete', null, null, 0, 'Retail', 0);
    expect(createRes.success).toBe(true);

    const delRes = await deactivateCustomer(createRes.data);
    expect(delRes.success).toBe(true);

    // Should no longer appear in active customers
    const customers = await getCustomers();
    expect(customers.find(c => c.id === createRes.data)).toBeUndefined();
  });

  it('rejects deactivation of non-existent customer', async () => {
    const res = await deactivateCustomer(crypto.randomUUID());
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe('verifyAllCustomersIntegrity', () => {
  it('reports clean for untampered customer ledgers', async () => {
    const res = await verifyAllCustomersIntegrity();
    expect(res.isCorrupt).toBe(false);
    expect(res.tamperedList).toEqual([]);
  });

  it('reports tampered customer after ledger mutation', async () => {
    // Create customer with a ledger entry via credit checkout
    const custRes = await createCustomer('Integrity Test', null, null, 10000, 'Retail', 1);
    const customerId = custRes.data;

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active)
      VALUES (?, 'Integrity Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    await processCheckout({
      customerId, cashierId: 'system-daemon',
      items: [{ itemId, name: 'Integrity Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }],
      subtotal: 1000, tax: 0, deliveryFee: 0, discount: 0, totalAmount: 1000, amountPaid: 0, paymentMethod: 'Credit'
    });

    // Verify clean before tampering
    const clean = await verifyAllCustomersIntegrity();
    expect(clean.isCorrupt).toBe(false);

    // Tamper the ledger entry
    db.prepare(`UPDATE customer_ledger SET amount = 9999 WHERE customer_id = ?`).run(customerId);

    // Verify corruption detected
    const corrupt = await verifyAllCustomersIntegrity();
    expect(corrupt.isCorrupt).toBe(true);
    expect(corrupt.tamperedList.length).toBeGreaterThanOrEqual(1);
  });
});
