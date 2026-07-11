import { describe, it, expect } from 'vitest';
import db from '@/lib/db';
import { createPurchaseOrder, receiveGoods, recordSupplierPayment, createProduct, deactivateProduct, createSupplier, getSuppliers, getSupplierLedger } from '../inventory';
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
    const firstRes = await receiveGoods(poId);
    expect(firstRes.success).toBe(true);

    const stockAfterFirst = db.prepare("SELECT stock_quantity FROM inventory WHERE id = ?").get(itemId) as { stock_quantity: number };
    expect(stockAfterFirst.stock_quantity).toBe(stockBefore.stock_quantity + 5000);

    // Second receive should fail
    const secondRes = await receiveGoods(poId);
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
    const receiveRes = await receiveGoods(poId);
    expect(receiveRes.success).toBe(true);

    const updatedItem = db.prepare(`SELECT stock_quantity, cost_price FROM inventory WHERE id = ?`).get(itemId) as { stock_quantity: number; cost_price: number };
    expect(updatedItem.stock_quantity).toBe(30000); // 10000 + 20000
    expect(updatedItem.cost_price).toBe(1400); // WAC updated
  });
});

describe('Product & Supplier CRUD', () => {
  it('creates a new product', async () => {
    const res = await createProduct('Test Product', 'Tools', 'pc', 10000, 500, 1000, 900, 5000);
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    const item = db.prepare("SELECT name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active FROM inventory WHERE id = ?").get(res.data) as any;
    expect(item.name).toBe('Test Product');
    expect(item.category).toBe('Tools');
    expect(item.unit).toBe('pc');
    expect(item.stock_quantity).toBe(10000);
    expect(item.cost_price).toBe(500);
    expect(item.selling_price).toBe(1000);
    expect(item.wholesale_price).toBe(900);
    expect(item.reorder_level).toBe(5000);
    expect(item.is_active).toBe(1);
  });

  it('rejects product with empty name', async () => {
    const res = await createProduct('', 'Tools', 'pc', 0, 0, 0, 0, 0);
    expect(res.success).toBe(false);
  });

  it('soft-deletes a product', async () => {
    const createRes = await createProduct('To Delete', 'Tools', 'pc', 0, 0, 0, 0, 0);
    expect(createRes.success).toBe(true);

    const delRes = await deactivateProduct(createRes.data);
    expect(delRes.success).toBe(true);
  });

  it('creates a supplier', async () => {
    const res = await createSupplier('Test Supplier Co.', 'Contact Person', '09171111111', null);
    expect(res.success).toBe(true);
    expect(res.data).toBeDefined();

    const sup = db.prepare("SELECT name, is_active FROM suppliers WHERE id = ?").get(res.data) as any;
    expect(sup.name).toBe('Test Supplier Co.');
    expect(sup.is_active).toBe(1);
  });

  it('rejects supplier with empty name', async () => {
    const res = await createSupplier('', null, null, null);
    expect(res.success).toBe(false);
  });

  it('retrieves all suppliers', async () => {
    const pre = await getSuppliers();
    const beforeCount = pre.length;

    await createSupplier('Supplier A', null, null, null);
    await createSupplier('Supplier B', null, null, null);

    const post = await getSuppliers();
    expect(post.length).toBe(beforeCount + 2);
  });

  it('records supplier payment and ledger entry', async () => {
    const supplierId = crypto.randomUUID();
    db.prepare(`INSERT INTO suppliers (id, name, current_balance, is_active) VALUES (?, 'Pay Supplier', 2000, 1)`).run(supplierId);

    const payRes = await recordSupplierPayment(supplierId, 1500, 'Partial payment');
    expect(payRes.success).toBe(true);
    expect(payRes.data).toBeDefined();

    const sup = db.prepare("SELECT current_balance FROM suppliers WHERE id = ?").get(supplierId) as { current_balance: number };
    expect(sup.current_balance).toBe(500);

    // Verify ledger entry
    const ledger = await getSupplierLedger(supplierId);
    expect(ledger.ledger.length).toBe(1);
    expect(ledger.isIntegrityViolated).toBe(false);
    expect(ledger.ledger[0].type).toBe('PAYMENT');
    expect(ledger.ledger[0].amount).toBe(1500);
  });

  it('detects tampered supplier ledger', async () => {
    const supplierId = crypto.randomUUID();
    db.prepare(`INSERT INTO suppliers (id, name, current_balance, is_active) VALUES (?, 'Tamper Supplier', 500, 1)`).run(supplierId);

    await recordSupplierPayment(supplierId, 500, 'Full payment');

    // Tamper
    db.prepare(`UPDATE supplier_ledger SET amount = 9999 WHERE supplier_id = ?`).run(supplierId);

    const ledger = await getSupplierLedger(supplierId);
    expect(ledger.isIntegrityViolated).toBe(true);
  });
});
