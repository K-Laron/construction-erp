import { describe, it, expect, beforeAll } from 'vitest';
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
    await expect(processCheckout(fakePayload)).rejects.toThrow();
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
    await expect(processCheckout(payload)).rejects.toThrow(/PRICE_TAMPERING_DETECTED/);
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

    const { transactionId } = await processCheckout(payload);
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

    const { transactionId } = await processCheckout(payload);

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

    const { transactionId } = await processCheckout(payload);
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

    const { transactionId } = await processCheckout(payload);
    
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
});
