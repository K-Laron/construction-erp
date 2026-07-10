"use server";

import db from '@/lib/db';
import { encryptField, decryptField } from '@/lib/crypto';
import { InventoryItem, Supplier, SupplierLedgerEntry } from '@/types';
import crypto from 'crypto';
import { createBalancedJournalEntry } from '@/lib/ledger_helpers';
import { calculateHMACSignature } from '@/lib/ledger_crypto';
import { getActiveUserId } from './auth';
import { getMlekSecret } from "@/lib/mlek";
import { z } from 'zod';

const CreateProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  unit: z.string().min(1, "Unit is required"),
  stockQtyMillicounts: z.number().int().nonnegative(),
  costPriceCentavos: z.number().int().nonnegative(),
  sellingPriceCentavos: z.number().int().nonnegative(),
  wholesalePriceCentavos: z.number().int().nonnegative(),
  reorderLevelMillicounts: z.number().int().nonnegative()
});

const CreateSupplierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().email().nullable().or(z.literal("")).or(z.null())
});

// Fetch active inventory (values in millicounts/centavos)
export async function getInventory(): Promise<InventoryItem[]> {
  getMlekSecret(false); // Ensure unlocked
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
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const parsed = CreateProductSchema.parse({
      name,
      category,
      unit,
      stockQtyMillicounts,
      costPriceCentavos,
      sellingPriceCentavos,
      wholesalePriceCentavos,
      reorderLevelMillicounts
    });
    getMlekSecret(); // Ensure unlocked
    const id = crypto.randomUUID();

    db.prepare(`
      INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      id,
      parsed.name,
      parsed.category,
      parsed.unit,
      parsed.stockQtyMillicounts,
      parsed.costPriceCentavos,
      parsed.sellingPriceCentavos,
      parsed.wholesalePriceCentavos,
      parsed.reorderLevelMillicounts
    );

    return { success: true, data: id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create product' };
  }
}

const DeactivateProductSchema = z.object({
  id: z.string().uuid()
});

// Soft delete product
export async function deactivateProduct(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = DeactivateProductSchema.parse({ id });
    getMlekSecret(); // Ensure unlocked
    const info = db.prepare("UPDATE inventory SET is_active = 0 WHERE id = ?").run(parsed.id);
    if (info.changes === 0) throw new Error("Product not found");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to deactivate product.' };
  }
}

// Fetch active suppliers
export async function getSuppliers(): Promise<Supplier[]> {
  const secret = getMlekSecret(false);
  const rows = db.prepare("SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name ASC").all() as { id: string, name: string, contact_person: string | null, phone: string | null, email: string | null, current_balance: number, is_active: number }[];

  return rows.map(r => ({
    ...r,
    phone: r.phone ? decryptField(r.phone, secret) : null,
    email: r.email ? decryptField(r.email, secret) : null
  }));
}

const CreatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  paymentMethod: z.enum(['Cash', 'Credit']),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    qtyMillicounts: z.number().int().positive(),
    unitPriceCentavos: z.number().int().nonnegative()
  })).min(1)
});

const DeactivateSupplierSchema = z.object({
  id: z.string().uuid()
});

// Create a supplier
export async function createSupplier(
  name: string,
  contactPerson: string | null,
  phone: string | null,
  email: string | null
): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    const parsed = CreateSupplierSchema.parse({ name, contactPerson, phone, email });
    const secret = getMlekSecret();
    const id = crypto.randomUUID();

    const encryptedPhone = parsed.phone ? encryptField(parsed.phone, secret) : null;
    const encryptedEmail = parsed.email ? encryptField(parsed.email, secret) : null;

    db.prepare(`
      INSERT INTO suppliers (id, name, contact_person, phone, email, current_balance, is_active)
      VALUES (?, ?, ?, ?, ?, 0, 1)
    `).run(id, parsed.name, parsed.contactPerson, encryptedPhone, encryptedEmail);

    return { success: true, data: id };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create supplier' };
  }
}

// Soft delete supplier
export async function deactivateSupplier(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = DeactivateSupplierSchema.parse({ id });
    getMlekSecret();
    const info = db.prepare("UPDATE suppliers SET is_active = 0 WHERE id = ?").run(parsed.id);
    if (info.changes === 0) throw new Error("Supplier not found");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Create a Purchase Order
export async function createPurchaseOrder(
  supplierId: string,
  paymentMethod: 'Cash' | 'Credit',
  items: { itemId: string; qtyMillicounts: number; unitPriceCentavos: number }[]
): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    const parsed = CreatePurchaseOrderSchema.parse({ supplierId, paymentMethod, items });
    getMlekSecret();
    const poId = crypto.randomUUID();

    const totalCost = parsed.items.reduce((sum, item) => sum + (item.qtyMillicounts * item.unitPriceCentavos / 1000), 0);
    const roundedTotalCost = Math.round(totalCost);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO purchase_orders (id, supplier_id, date, total_cost, payment_method, status)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, 'Draft')
      `).run(poId, parsed.supplierId, roundedTotalCost, parsed.paymentMethod);

      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (id, purchase_order_id, item_id, quantity, unit_price, total_cost)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const item of parsed.items) {
        const lineCost = Math.round(item.qtyMillicounts * item.unitPriceCentavos / 1000);
        insertItem.run(crypto.randomUUID(), poId, item.itemId, item.qtyMillicounts, item.unitPriceCentavos, lineCost);
      }
    })();

    return { success: true, data: poId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create purchase order' };
  }
}

const ReceiveGoodsSchema = z.object({
  purchaseOrderId: z.string().uuid()
});

// Receive Goods & Update Weighted Average Cost (WAC)
export async function receiveGoods(purchaseOrderId: string, _ignoredReceivedBy: string): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    const parsed = ReceiveGoodsSchema.parse({ purchaseOrderId });
    getMlekSecret();
    const receivedBy = await getActiveUserId();
    const receiptId = crypto.randomUUID();

    db.transaction(() => {
      // 1. Mark PO as Received
      db.prepare("UPDATE purchase_orders SET status = 'Received' WHERE id = ?").run(parsed.purchaseOrderId);

      // 2. Log goods receipt
      db.prepare(`
        INSERT INTO goods_receipts (id, purchase_order_id, date, received_by)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      `).run(receiptId, parsed.purchaseOrderId, receivedBy);

      // 3. Fetch PO details
      const po = db.prepare("SELECT supplier_id, total_cost, payment_method FROM purchase_orders WHERE id = ?").get(parsed.purchaseOrderId) as {
        supplier_id: string;
        total_cost: number;
        payment_method: 'Cash' | 'Credit';
      };

      const poItems = db.prepare("SELECT * FROM purchase_order_items WHERE purchase_order_id = ?").all(parsed.purchaseOrderId) as { id: string, purchase_order_id: string, item_id: string, quantity: number, unit_price: number, total_price: number }[];

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
        const entryData = { id: ledgerId, supplier_id: po.supplier_id, date: new Date().toISOString(), type: 'CHARGE' as const, amount: po.total_cost, reference_id: parsed.purchaseOrderId, description: 'Goods Receipt (Credit)' };
        const signature = calculateHMACSignature(entryData, prevSig, getMlekSecret());

        db.prepare(`
          INSERT INTO supplier_ledger (id, supplier_id, date, type, amount, reference_id, description, hmac_signature)
          VALUES (?, ?, ?, 'CHARGE', ?, ?, 'Goods Receipt (Credit)', ?)
        `).run(ledgerId, po.supplier_id, entryData.date, po.total_cost, parsed.purchaseOrderId, signature);
      }

      // 6. Record Bookkeeping Journal
      // Debit Inventory Asset (1210)
      // Credit Accounts Payable (2010) (if Credit) or Cash Drawer (1010) (if Cash)
      const creditAccount = po.payment_method === 'Credit' ? 'acc-ap' : 'acc-cash';
      createBalancedJournalEntry(
        `Received goods for PO: ${parsed.purchaseOrderId}`,
        [
          { accountId: 'acc-inv', type: 'DEBIT', amount: po.total_cost },
          { accountId: creditAccount, type: 'CREDIT', amount: po.total_cost }
        ],
        receivedBy
      );
    })();

    return { success: true, data: receiptId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to receive goods' };
  }
}

// Retrieve supplier ledger and check HMAC signature validity
export async function getSupplierLedger(supplierId: string): Promise<{ ledger: SupplierLedgerEntry[]; isIntegrityViolated: boolean }> {
  getMlekSecret(false); // Ensure unlocked
  const rows = db.prepare("SELECT * FROM supplier_ledger WHERE supplier_id = ? ORDER BY date ASC").all(supplierId) as SupplierLedgerEntry[];

  let prevSig = "GENESIS";
  let isIntegrityViolated = false;

  for (const entry of rows) {
    const expectedSig = calculateHMACSignature(entry, prevSig, getMlekSecret(false));
    if (entry.hmac_signature !== expectedSig) {
      isIntegrityViolated = true;
    }
    prevSig = entry.hmac_signature || "CORRUPT";
  }

  return { ledger: rows, isIntegrityViolated };
}
