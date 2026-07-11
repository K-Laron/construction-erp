import { describe, it, expect } from 'vitest';
import { processCheckout, processReturn } from '../transactions';
import crypto from 'crypto';
import db from '@/lib/db';
import { getInventory } from '../inventory';
import { authenticateUser } from '../auth';

describe('Transaction Server Actions', () => {

  it('rejects tampered checkout payloads with incorrect math', async () => {
    const fakePayload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId: 'item-blocks-4', name: 'Hollow Block 4"', quantity: 1000, unitUsed: 'pc', unitPrice: 2000, unitCost: 1500, totalPrice: 2000 }
      ],
      subtotal: 5000, // Deliberately tampered subtotal to be larger than sum of items (2000)
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 5000,
      amountPaid: 5000,
      paymentMethod: 'Cash' as const
    };

    // Note: since unitPrice is 2000 but the DB has whatever price, it will likely hit PRICE_TAMPERING_DETECTED first,
    // or if the item doesn't exist, it hits "not found".
    const res = await processCheckout(fakePayload);
    expect(res.success).toBe(false);
  });

  it('rejects tampered unit prices (C1 fix)', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test C1', 'Tools', 'pc', 10000, 500, 1000, 900, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test C1', quantity: 1000, unitUsed: 'pc', unitPrice: 500, unitCost: 500, totalPrice: 500 }
      ],
      subtotal: 500,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 500,
      amountPaid: 500,
      paymentMethod: 'Cash' as const
    };

    // Client sent unitPrice=500 but DB says selling_price=1000
    const res = await processCheckout(payload);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/PRICE_TAMPERING_DETECTED/);
  });

  it('recalculates tax server-side (C2 fix)', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test C2', 'Tools', 'pc', 10000, 500, 1120, 1120, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test C2', quantity: 1000, unitUsed: 'pc', unitPrice: 1120, unitCost: 500, totalPrice: 1120 }
      ],
      subtotal: 1120,
      tax: 0, // Client tries to underreport tax
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1120,
      amountPaid: 1120,
      paymentMethod: 'Cash' as const
    };

    const { data: { transactionId } } = (await processCheckout(payload)) as { data: { transactionId: string } };
    const tx = db.prepare("SELECT tax FROM transactions WHERE id = ?").get(transactionId) as { tax: number };
    
    // Server should have recalculated tax: (1120 / 1.12) * 0.12 = 120
    expect(tx.tax).toBe(120);
  });

  it('records correct GL entries on checkout and return', async () => {
    // Clear previous GL entries to prevent shared state interference from previous tests
    db.prepare('DELETE FROM journal_lines').run();
    db.prepare('DELETE FROM journal_entries').run();

    // Need a customer
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, created_at) VALUES (?, 'Test Cust', 1000, 0, 1, CURRENT_TIMESTAMP)`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test Item', 'Tools', 'pc', 10000, 500, 1120, 1120, 1)`).run(itemId);

    const payload = {
      customerId,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test', quantity: 1000, unitUsed: 'pc', unitPrice: 1120, unitCost: 500, totalPrice: 1120 }
      ],
      subtotal: 1120, // includes 120 tax
      tax: 120,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1120,
      amountPaid: 1120,
      paymentMethod: 'Cash' as const
    };

    const { data: { transactionId } } = (await processCheckout(payload)) as { data: { transactionId: string } };

    // Verify GL entries for sale
    const journalLine = db.prepare(`SELECT SUM(amount) as total FROM journal_lines WHERE account_id = 'acc-vat-payable' AND type = 'CREDIT'`).get() as { total: number };
    expect(journalLine.total).toBe(120);

    const revLine = db.prepare(`SELECT SUM(amount) as total FROM journal_lines WHERE account_id = 'acc-revenue' AND type = 'CREDIT'`).get() as { total: number };
    expect(revLine.total).toBe(1000); // 1120 - 120

    // Process a return
    await processReturn(transactionId, [
      { itemId, quantity: 1000 }
    ]);

    // Return should debit vat-payable by 120
    const returnVatLine = db.prepare(`SELECT SUM(amount) as total FROM journal_lines WHERE account_id = 'acc-vat-payable' AND type = 'DEBIT'`).get() as { total: number };
    expect(returnVatLine.total).toBe(120);

    const returnRevLine = db.prepare(`SELECT SUM(amount) as total FROM journal_lines WHERE account_id = 'acc-revenue' AND type = 'DEBIT'`).get() as { total: number };
    expect(returnRevLine.total).toBe(1000);
  });

  it('processes checkout with vat-exempt customer', async () => {
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, is_vat_exempt, created_at) VALUES (?, 'VAT Exempt Cust', 1000, 0, 1, 1, CURRENT_TIMESTAMP)`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 1000,
      paymentMethod: 'Cash' as const
    };

    const { data: { transactionId } } = (await processCheckout(payload)) as { data: { transactionId: string } };
    const tx = db.prepare("SELECT tax FROM transactions WHERE id = ?").get(transactionId) as { tax: number };
    
    // Server should have set tax to 0 because customer is VAT exempt
    expect(tx.tax).toBe(0);
  });

  it('handles credit returns and adjusts ledger correctly', async () => {
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, created_at) VALUES (?, 'Credit Cust', 5000, 0, 1, CURRENT_TIMESTAMP)`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test Credit Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test Credit Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 0,
      paymentMethod: 'Credit' as const
    };

    const { data: { transactionId } } = (await processCheckout(payload)) as { data: { transactionId: string } };
    
    // Customer balance should be 1000
    const cust1 = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId) as { current_balance: number };
    expect(cust1.current_balance).toBe(1000);

    // Process full return (cancel)
    await processReturn(transactionId, [
      { itemId, quantity: 1000 }
    ]);

    // Customer balance should be 0 again
    const cust2 = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId) as { current_balance: number };
    expect(cust2.current_balance).toBe(0);
  });

  it('rejects credit checkout without a customer ID (C2)', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test C2 Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test C2 Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 0,
      paymentMethod: 'Credit' as const
    };

    const res = await processCheckout(payload);
    expect(res.success).toBe(false);
    expect(res.error).toContain('CREDIT_CUSTOMER_REQUIRED');
  });

  it('calculates tax including delivery fee under Option A', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test Tax Item', 'Tools', 'pc', 10000, 5000, 11200, 11200, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test Tax Item', quantity: 1000, unitUsed: 'pc', unitPrice: 11200, unitCost: 5000, totalPrice: 11200 }
      ],
      subtotal: 11200,
      tax: 1320, // 12% on (11200 subtotal + 1120 deliveryFee) = 12320 total. 12320 / 1.12 * 0.12 = 1320.
      deliveryFee: 1120,
      discount: 0,
      totalAmount: 12320,
      amountPaid: 12320,
      paymentMethod: 'Cash' as const
    };

    const res = await processCheckout(payload);
    if (!res.success) {
      console.log("CHECKOUT ERROR DETAIL:", res.error);
    }
    expect(res.success).toBe(true);
  });

  function sumAccount(accountId: string, type: 'DEBIT' | 'CREDIT') {
    return (db.prepare(
      `SELECT COALESCE(SUM(amount),0) as total FROM journal_lines WHERE account_id = ? AND type = ?`
    ).get(accountId, type) as { total: number }).total;
  }

  it('Credit with down payment posts Cash + AR debits and revenue credit', async () => {
    db.prepare('DELETE FROM journal_lines').run();
    db.prepare('DELETE FROM journal_entries').run();

    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, is_vat_exempt, created_at) VALUES (?, 'Credit DP Cust', 10000, 0, 1, 1, CURRENT_TIMESTAMP)`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Credit DP Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Credit DP Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 400,
      paymentMethod: 'Credit' as const
    };

    const res = await processCheckout(payload);
    expect(res.success).toBe(true);

    expect(sumAccount('acc-cash', 'DEBIT')).toBe(400);
    expect(sumAccount('acc-ar', 'DEBIT')).toBe(600);
    expect(sumAccount('acc-revenue', 'CREDIT')).toBe(1000);

    const jeCount = db.prepare('SELECT COUNT(*) as cnt FROM journal_entries').get() as { cnt: number };
    expect(jeCount.cnt).toBeGreaterThanOrEqual(1);

    const cust = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId) as { current_balance: number };
    expect(cust.current_balance).toBe(600);
  });

  it('Check full payment posts Cash debit and journal entry', async () => {
    db.prepare('DELETE FROM journal_lines').run();
    db.prepare('DELETE FROM journal_entries').run();

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Check Full Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Check Full Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 1000,
      paymentMethod: 'Check' as const
    };

    const res = await processCheckout(payload);
    expect(res.success).toBe(true);

    // Server recalculates tax: (1000 / 1.12) * 0.12 = 107
    expect(sumAccount('acc-cash', 'DEBIT')).toBe(1000);
    expect(sumAccount('acc-revenue', 'CREDIT')).toBe(893);
    expect(sumAccount('acc-vat-payable', 'CREDIT')).toBe(107);

    const jeCount = db.prepare('SELECT COUNT(*) as cnt FROM journal_entries').get() as { cnt: number };
    expect(jeCount.cnt).toBeGreaterThanOrEqual(1);
  });

  it('rejects overpayment', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Overpay Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Overpay Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 1001,
      paymentMethod: 'Cash' as const
    };

    const res = await processCheckout(payload);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/OVERPAYMENT/);
  });

  it('rejects partial cash without customer (CUSTOMER_REQUIRED_FOR_BALANCE)', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Partial No Cust', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Partial No Cust', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 400,
      paymentMethod: 'Cash' as const
    };

    const res = await processCheckout(payload);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/CUSTOMER_REQUIRED_FOR_BALANCE/);
  });

  it('applies return refunds to customer outstanding balance first (M5)', async () => {
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, created_at) VALUES (?, 'M5 Customer', 10000, 0, 1, CURRENT_TIMESTAMP)`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test M5 Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    // 1. Create a credit transaction for 5000 (customer balance becomes 5000)
    const creditPayload = {
      customerId,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test M5 Item', quantity: 5000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 5000 }
      ],
      subtotal: 5000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 5000,
      amountPaid: 0,
      paymentMethod: 'Credit' as const
    };
    const { data: { transactionId: creditTxId } } = (await processCheckout(creditPayload)) as { data: { transactionId: string } };

    // 2. Create a cash transaction for 1000 (balance_due = 0)
    const cashPayload = {
      customerId,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Test M5 Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 1000,
      paymentMethod: 'Cash' as const
    };
    const { data: { transactionId: cashTxId } } = (await processCheckout(cashPayload)) as { data: { transactionId: string } };

    // 3. Process return of cash transaction. Since customer has outstanding balance (5000), it should reduce it by 1000 and NOT refund cash.
    const beforeCash = db.prepare("SELECT balance FROM accounts WHERE id = 'acc-cash'").get() as { balance: number };
    
    await processReturn(cashTxId, [
      { itemId, quantity: 1000 }
    ]);

    // Customer balance should be 4000 (reduced by 1000)
    const cust = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(customerId) as { current_balance: number };
    expect(cust.current_balance).toBe(4000);

    // The credit transaction's balance_due should be 4000 (reduced by 1000)
    const creditTx = db.prepare("SELECT balance_due FROM transactions WHERE id = ?").get(creditTxId) as { balance_due: number };
    expect(creditTx.balance_due).toBe(4000);

    // Cash account balance should NOT change (0 cash refund)
    const afterCash = db.prepare("SELECT balance FROM accounts WHERE id = 'acc-cash'").get() as { balance: number };
    expect(afterCash.balance).toBe(beforeCash.balance);
  });

  it('rejects checkout when stock insufficient', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active)
      VALUES (?, 'Low Stock Item', 'Tools', 'pc', 500, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Low Stock Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 1000,
      paymentMethod: 'Cash' as const
    };

    const res = await processCheckout(payload);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/INSUFFICIENT_STOCK/);
  });

  it('rejects checkout when stock drops to exactly zero (concurrent guard)', async () => {
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active)
      VALUES (?, 'Exact Stock Item', 'Tools', 'pc', 1000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId: null,
      cashierId: 'system-daemon',
      items: [
        { itemId, name: 'Exact Stock Item', quantity: 1000, unitUsed: 'pc', unitPrice: 1000, unitCost: 500, totalPrice: 1000 }
      ],
      subtotal: 1000,
      tax: 0,
      deliveryFee: 0,
      discount: 0,
      totalAmount: 1000,
      amountPaid: 1000,
      paymentMethod: 'Cash' as const
    };

    // First should succeed
    const res1 = await processCheckout(payload);
    expect(res1.success).toBe(true);

    // Second should fail (stock now 0)
    const res2 = await processCheckout(payload);
    expect(res2.success).toBe(false);
    expect(res2.error).toMatch(/INSUFFICIENT_STOCK/);
  });
});
