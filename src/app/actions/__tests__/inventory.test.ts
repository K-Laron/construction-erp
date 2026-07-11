import { describe, it, expect } from 'vitest';
import db from '@/lib/db';
import { createPurchaseOrder, receiveGoods, recordSupplierPayment } from '../inventory';
import crypto from 'crypto';

describe('Inventory Actions', () => {
  it('rejects double receiveGoods (idempotency)', async () => {
    const supplierId = crypto.randomUUID();
    db.prepare(`INSERT INTO suppliers (id, name, current_balance, is_active) VALUES (?, 'Double Recv Supplier', 0, 1)`).run(supplierId);

    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active)
      VALUES (?, 'Double Recv Item', 'Hardware', 'pc', 10000, 1000, 2000, 1800, 1)`).run(itemId);

    const poRes = await createPurchaseOrder(supplierId, 'Credit', [
      { itemId, qtyMillicounts: 5000, unitPriceCentavos: 2000 }
    ]);
    expect(poRes.success).toBe(true);
    const poId = poRes.data!;

    const stockBefore = db.prepare("SELECT stock_quantity FROM inventory WHERE id = ?").get(itemId) as { stock_quantity: number };
    const supplierBefore = db.prepare("SELECT current_balance FROM suppliers WHERE id = ?").get(supplierId) as { current_balance: number };

    // First receive should succeed
    const firstRes = await receiveGoods(poId, 'test-user');
    expect(firstRes.success).toBe(true);

    const stockAfterFirst = db.prepare("SELECT stock_quantity FROM inventory WHERE id = ?").get(itemId) as { stock_quantity: number };
    expect(stockAfterFirst.stock_quantity).toBe(stockBefore.stock_quantity + 5000);

    // Second receive should fail
    const secondRes = await receiveGoods(poId, 'test-user');
    expect(secondRes.success).toBe(false);
    expect(secondRes.error).toMatch(/ALREADY_RECEIVED|INVALID_PO_STATUS/i);

    // Stock unchanged after second attempt
    const stockAfterSecond = db.prepare("SELECT stock_quantity FROM inventory WHERE id = ?").get(itemId) as { stock_quantity: number };
    expect(stockAfterSecond.stock_quantity).toBe(stockAfterFirst.stock_quantity);

    // Supplier balance not doubled
    const supplierAfter = db.prepare("SELECT current_balance FROM suppliers WHERE id = ?").get(supplierId) as { current_balance: number };
    expect(supplierAfter.current_balance).toBe(supplierBefore.current_balance + 10000); // 5 * 2000 = 10000 centavos
  });

  it('rejects supplier payment exceeding outstanding balance', async () => {
    const supplierId = crypto.randomUUID();
    db.prepare(`INSERT INTO suppliers (id, name, current_balance, is_active) VALUES (?, 'Floor Supplier', 500, 1)`).run(supplierId);

    // Try to pay 501 when balance is only 500
    const res = await recordSupplierPayment(supplierId, 501, 'Overpay attempt');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/OVERPAYMENT|exceed|balance/i);

    // Balance unchanged
    const supAfter = db.prepare("SELECT current_balance FROM suppliers WHERE id = ?").get(supplierId) as { current_balance: number };
    expect(supAfter.current_balance).toBe(500);
  });

  it('recalculates WAC correctly on processPO', async () => {
    // Insert a dummy supplier
    const supplierId = crypto.randomUUID();
    db.prepare(`INSERT INTO suppliers (id, name, current_balance, is_active) VALUES (?, 'Test Supplier', 0, 1)`).run(supplierId);

    // Insert a dummy item with WAC = 1000 and Qty = 10
    const itemId = crypto.randomUUID();
    db.prepare(`INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, is_active)
      VALUES (?, 'Test Item', 'Hardware', 'pc', 10000, 1000, 2000, 1800, 1)`).run(itemId);

    // We buy 20 more at cost 1600.
    // New WAC = ((10 * 1000) + (20 * 1600)) / 30 = (10000 + 32000) / 30 = 42000 / 30 = 1400.
    // Stock quantity is millicounts, so 10 = 10000, 20 = 20000.
    // processPO takes standard units.
    const poRes = await createPurchaseOrder(supplierId, 'Cash', [
      { itemId, qtyMillicounts: 20000, unitPriceCentavos: 1600 }
    ]);
    expect(poRes.success).toBe(true);
    const poId = poRes.data!;
    const receiveRes = await receiveGoods(poId, 'test-user');
    expect(receiveRes.success).toBe(true);

    const updatedItem = db.prepare(`SELECT stock_quantity, cost_price FROM inventory WHERE id = ?`).get(itemId) as { stock_quantity: number; cost_price: number };
    expect(updatedItem.stock_quantity).toBe(30000); // 10000 + 20000
    expect(updatedItem.cost_price).toBe(1400); // WAC updated
  });
});
