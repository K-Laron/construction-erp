"use server";

import db from '@/lib/db';
import { encryptField, decryptField } from '@/lib/crypto';
import { InventoryItem, Supplier, SupplierLedgerEntry } from '@/types';
import crypto from 'crypto';
import { createBalancedJournalEntry } from '@/lib/ledger_helpers';
import { calculateHMACSignature } from '@/lib/ledger_crypto';
import { getActiveUserId } from './auth';
import { getMlekSecret } from "@/lib/mlek";

// Fetch active inventory (values in millicounts/centavos)
export async function getInventory(): Promise<InventoryItem[]> {
  getMlekSecret(); // Ensure unlocked
  return db.prepare("SELECT * FROM inventory WHERE is_active = 1 ORDER BY name ASC").all() as InventoryItem[];
}

// Create a new product
export async function createProduct(
  name: string,
  category: string,
  unit: string,
  stockQtyMillicounts: number,
  costPriceCentavos: number,
  sellingPriceCentavos: number,
  wholesalePriceCentavos: number,
  reorderLevelMillicounts: number
): Promise<string> {
  getMlekSecret(); // Ensure unlocked
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    name,
    category,
    unit,
    stockQtyMillicounts,
    costPriceCentavos,
    sellingPriceCentavos,
    wholesalePriceCentavos,
    reorderLevelMillicounts
  );

  return id;
}

// Soft delete product
export async function deactivateProduct(id: string): Promise<void> {
  getMlekSecret(); // Ensure unlocked
  db.prepare("UPDATE inventory SET is_active = 0 WHERE id = ?").run(id);
}

// Fetch active suppliers
export async function getSuppliers(): Promise<Supplier[]> {
  const secret = getMlekSecret();
  const rows = db.prepare("SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name ASC").all() as any[];

  return rows.map(r => ({
    ...r,
    phone: r.phone ? decryptField(r.phone, secret) : null,
    email: r.email ? decryptField(r.email, secret) : null
  }));
}

// Create a supplier
export async function createSupplier(
  name: string,
  contactPerson: string | null,
  phone: string | null,
  email: string | null
): Promise<string> {
  const secret = getMlekSecret();
  const id = crypto.randomUUID();

  const encryptedPhone = phone ? encryptField(phone, secret) : null;
  const encryptedEmail = email ? encryptField(email, secret) : null;

  db.prepare(`
    INSERT INTO suppliers (id, name, contact_person, phone, email, current_balance, is_active)
    VALUES (?, ?, ?, ?, ?, 0, 1)
  `).run(id, name, contactPerson, encryptedPhone, encryptedEmail);

  return id;
}

// Soft delete supplier
export async function deactivateSupplier(id: string): Promise<void> {
  getMlekSecret();
  db.prepare("UPDATE suppliers SET is_active = 0 WHERE id = ?").run(id);
}

// Create a Purchase Order
export async function createPurchaseOrder(
  supplierId: string,
  paymentMethod: 'Cash' | 'Credit',
  items: { itemId: string; qtyMillicounts: number; unitPriceCentavos: number }[]
): Promise<string> {
  getMlekSecret();
  const poId = crypto.randomUUID();

  const totalCost = items.reduce((sum, item) => sum + (item.qtyMillicounts * item.unitPriceCentavos / 1000), 0);
  const roundedTotalCost = Math.round(totalCost);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO purchase_orders (id, supplier_id, date, total_cost, payment_method, status)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, 'Draft')
    `).run(poId, supplierId, roundedTotalCost, paymentMethod);

    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (id, purchase_order_id, item_id, quantity, unit_price, total_cost)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      const lineCost = Math.round(item.qtyMillicounts * item.unitPriceCentavos / 1000);
      insertItem.run(crypto.randomUUID(), poId, item.itemId, item.qtyMillicounts, item.unitPriceCentavos, lineCost);
    }
  })();

  return poId;
}

// Receive Goods & Update Weighted Average Cost (WAC)
export async function receiveGoods(purchaseOrderId: string, _ignoredReceivedBy: string): Promise<string> {
  getMlekSecret();
  const receivedBy = await getActiveUserId();
  const receiptId = crypto.randomUUID();

  db.transaction(() => {
    // 1. Mark PO as Received
    db.prepare("UPDATE purchase_orders SET status = 'Received' WHERE id = ?").run(purchaseOrderId);

    // 2. Log goods receipt
    db.prepare(`
      INSERT INTO goods_receipts (id, purchase_order_id, date, received_by)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?)
    `).run(receiptId, purchaseOrderId, receivedBy);

    // 3. Fetch PO details
    const po = db.prepare("SELECT supplier_id, total_cost, payment_method FROM purchase_orders WHERE id = ?").get(purchaseOrderId) as {
      supplier_id: string;
      total_cost: number;
      payment_method: 'Cash' | 'Credit';
    };

    const poItems = db.prepare("SELECT * FROM purchase_order_items WHERE purchase_order_id = ?").all(purchaseOrderId) as any[];

    // 4. Update stock quantities and WAC cost prices
    const updateInventory = db.prepare(`
      UPDATE inventory 
      SET stock_quantity = stock_quantity + ?,
          cost_price = ?
      WHERE id = ?
    `);

    for (const item of poItems) {
      const current = db.prepare("SELECT stock_quantity, cost_price FROM inventory WHERE id = ?").get(item.item_id) as {
        stock_quantity: number;
        cost_price: number;
      };

      const newQty = current.stock_quantity + item.quantity;
      let newWac = current.cost_price;

      if (newQty > 0) {
        // WAC = ((currentQty * currentCost) + (receivedQty * receivedCost)) / (currentQty + receivedQty)
        const currentVal = current.stock_quantity * current.cost_price;
        const receivedVal = item.quantity * item.unit_price;
        newWac = Math.round((currentVal + receivedVal) / newQty);
      }

      updateInventory.run(item.quantity, newWac, item.item_id);

      // L5: Stock audit trail (direction IN)
      db.prepare(`
        INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
        VALUES (?, CURRENT_TIMESTAMP, ?, 'STOCK_IN', ?, ?, ?)
      `).run(crypto.randomUUID(), receivedBy, item.item_id, current.stock_quantity.toString(), newQty.toString());
    }

    // 5. Update Supplier balance if Credit
    if (po.payment_method === 'Credit') {
      db.prepare("UPDATE suppliers SET current_balance = current_balance + ? WHERE id = ?").run(po.total_cost, po.supplier_id);
      const lastLedger = db.prepare(`SELECT hmac_signature FROM supplier_ledger WHERE supplier_id = ? ORDER BY date DESC LIMIT 1`).get(po.supplier_id) as { hmac_signature: string } | undefined;
      const prevSig = lastLedger ? lastLedger.hmac_signature : "GENESIS";
      const ledgerId = crypto.randomUUID();
      const entryData = { id: ledgerId, supplier_id: po.supplier_id, date: new Date().toISOString(), type: 'CHARGE' as const, amount: po.total_cost, reference_id: purchaseOrderId, description: 'Goods Receipt (Credit)' };
      const signature = calculateHMACSignature(entryData, prevSig, getMlekSecret());

      db.prepare(`
        INSERT INTO supplier_ledger (id, supplier_id, date, type, amount, reference_id, description, hmac_signature)
        VALUES (?, ?, ?, 'CHARGE', ?, ?, 'Goods Receipt (Credit)', ?)
      `).run(ledgerId, po.supplier_id, entryData.date, po.total_cost, purchaseOrderId, signature);
    }

    // 6. Record Bookkeeping Journal
    // Debit Inventory Asset (1210)
    // Credit Accounts Payable (2010) (if Credit) or Cash Drawer (1010) (if Cash)
    const creditAccount = po.payment_method === 'Credit' ? 'acc-ap' : 'acc-cash';
    createBalancedJournalEntry(
      `Received goods for PO: ${purchaseOrderId}`,
      [
        { accountId: 'acc-inv', type: 'DEBIT', amount: po.total_cost },
        { accountId: creditAccount, type: 'CREDIT', amount: po.total_cost }
      ],
      receivedBy
    );
  })();

  return receiptId;
}

// Retrieve supplier ledger and check HMAC signature validity
export async function getSupplierLedger(supplierId: string): Promise<{ ledger: SupplierLedgerEntry[]; isIntegrityViolated: boolean }> {
  getMlekSecret(); // Ensure unlocked
  const rows = db.prepare("SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY date ASC").all(supplierId) as SupplierLedgerEntry[];

  let prevSig = "GENESIS";
  let isIntegrityViolated = false;

  for (const entry of rows) {
    const expectedSig = calculateHMACSignature(entry, prevSig, getMlekSecret());
    if (entry.hmac_signature !== expectedSig) {
      isIntegrityViolated = true;
    }
    prevSig = entry.hmac_signature || "CORRUPT";
  }

  return { ledger: rows, isIntegrityViolated };
}
