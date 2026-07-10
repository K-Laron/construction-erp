import { describe, it, expect, beforeAll } from 'vitest';
import db from '@/lib/db';
import { createPurchaseOrder, receiveGoods } from '../inventory';
import crypto from 'crypto';

describe('Inventory Actions', () => {
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
    const poId = await createPurchaseOrder(supplierId, 'Cash', [
      { itemId, qtyMillicounts: 20000, unitPriceCentavos: 1600 }
    ]);
    await receiveGoods(poId, 'test-user');

    const updatedItem = db.prepare(`SELECT stock_quantity, cost_price FROM inventory WHERE id = ?`).get(itemId) as any;
    expect(updatedItem.stock_quantity).toBe(30000); // 10000 + 20000
    expect(updatedItem.cost_price).toBe(1400); // WAC updated
  });
});
