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

    await expect(processCheckout(fakePayload)).rejects.toThrow(/MATH_TAMPERING_DETECTED/);
  });

  it('records correct GL entries on checkout and return', async () => {
    // Need a customer
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, created_at) VALUES (?, 'Test Cust', 1000, 0, 1, datetime('now'))`).run(customerId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active) VALUES (?, 'Test Item', 'Tools', 'pc', 10000, 500, 1000, 1000, 1)`).run(itemId);

    const payload = {
      customerId,
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
      { itemId, quantity: 1000, isRestock: true }
    ], 'user');

    // Return should debit vat-payable by 120
    const returnVatLine = db.prepare(`SELECT SUM(amount) as total FROM journal_lines WHERE account_id = 'acc-vat-payable' AND type = 'DEBIT'`).get() as { total: number };
    expect(returnVatLine.total).toBe(120);

    const returnRevLine = db.prepare(`SELECT SUM(amount) as total FROM journal_lines WHERE account_id = 'acc-revenue' AND type = 'DEBIT'`).get() as { total: number };
    expect(returnRevLine.total).toBe(1000);
  });
});
