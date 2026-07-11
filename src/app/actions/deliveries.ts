"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { getActiveUserId, requireAuth } from './auth';
import { checkMlek } from "@/lib/mlek";
import { z } from 'zod';

const DispatchDeliverySchema = z.object({
  transactionId: z.string().uuid(),
  driverName: z.string().min(1, "Driver name is required"),
  truckPlate: z.string().min(1, "Truck plate is required"),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    quantityDelivered: z.number().int().positive()
  })).min(1),
  helperWorkerIds: z.array(z.string().uuid()).default([])
});


// Fetch pending deliveries
export async function getPendingDeliveries(): Promise<{ transaction_id: string, date: string, delivery_status: string, customer_name: string | null, customer_id: string | null, total_amount: number }[]> {
  await requireAuth();
  checkMlek(false);
  return db.prepare(`
    SELECT t.id as transaction_id, t.date, t.delivery_status,
           c.name as customer_name, c.id as customer_id,
           t.total_amount
    FROM transactions t
    LEFT JOIN customers c ON t.customer_id = c.id
    WHERE t.delivery_status IN ('Pending', 'Partially Delivered')
    ORDER BY t.date ASC
  `).all() as { transaction_id: string; date: string; delivery_status: string; customer_name: string | null; customer_id: string | null; total_amount: number; }[];
}

// Fetch items remaining for a transaction
export async function getDeliveryRemainingItems(transactionId: string): Promise<{ item_id: string, item_name: string, unit: string, ordered_qty: number, delivered_qty: number, remaining_qty: number }[]> {
  await requireAuth();
  checkMlek(false);

  return db.prepare(`
    WITH cte AS (
      SELECT 
        ti.item_id, i.name as item_name, i.unit,
        ti.quantity as ordered_qty,
        COALESCE(
          (SELECT SUM(di.quantity_delivered) FROM delivery_items di 
           JOIN deliveries d ON di.delivery_id = d.id 
           WHERE d.transaction_id = ? AND di.item_id = ti.item_id), 0
        ) as delivered_qty
      FROM transaction_items ti
      JOIN inventory i ON ti.item_id = i.id
      WHERE ti.transaction_id = ?
    )
    SELECT *, ordered_qty - delivered_qty as remaining_qty
    FROM cte
    WHERE (ordered_qty - delivered_qty) > 0
  `).all(transactionId, transactionId) as { item_id: string, item_name: string, unit: string, ordered_qty: number, delivered_qty: number, remaining_qty: number }[];
}

// Dispatch a delivery trip
export async function dispatchDelivery(
  transactionId: string,
  driverName: string,
  truckPlate: string,
  items: { itemId: string; quantityDelivered: number }[], // millicounts
  helperWorkerIds: string[] = []
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const parsed = DispatchDeliverySchema.parse({
      transactionId,
      driverName,
      truckPlate,
      items,
      helperWorkerIds
    });
    checkMlek();
    const userId = await requireAuth();

    const deliveryId = crypto.randomUUID();

    db.transaction(() => {
      // M2, M3: Validate remaining quantity before dispatching INSIDE transaction
      const remaining = db.prepare(`
        WITH cte AS (
          SELECT 
            ti.item_id, ti.quantity as ordered_qty,
            COALESCE(
              (SELECT SUM(di.quantity_delivered) FROM delivery_items di 
               JOIN deliveries d ON di.delivery_id = d.id 
               WHERE d.transaction_id = ? AND di.item_id = ti.item_id), 0
            ) as delivered_qty
          FROM transaction_items ti
          WHERE ti.transaction_id = ?
        )
        SELECT *, ordered_qty - delivered_qty as remaining_qty
        FROM cte
        WHERE (ordered_qty - delivered_qty) > 0
      `).all(parsed.transactionId, parsed.transactionId) as { item_id: string; remaining_qty: number }[];

      for (const item of parsed.items) {
        const rem = remaining.find(r => r.item_id === item.itemId);
        if (!rem) throw new Error(`Item ${item.itemId} is not part of this transaction or fully delivered.`);
        if (item.quantityDelivered > rem.remaining_qty) {
          throw new Error(`DISPATCH_EXCEEDS_REMAINING: Item ${item.itemId} remaining is ${rem.remaining_qty}, but trying to dispatch ${item.quantityDelivered}.`);
        }
      }
      // 1. Create delivery record
      db.prepare(`
        INSERT INTO deliveries (id, transaction_id, delivery_date, driver_name, truck_plate, status)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, 'Dispatched')
      `).run(deliveryId, parsed.transactionId, parsed.driverName, parsed.truckPlate);

      // 2. Insert delivery items
      const insertItem = db.prepare(`
        INSERT INTO delivery_items (id, delivery_id, item_id, quantity_delivered)
        VALUES (?, ?, ?, ?)
      `);

      for (const item of parsed.items) {
        insertItem.run(crypto.randomUUID(), deliveryId, item.itemId, item.quantityDelivered);
      }

      // 3. Assign helpers
      if (parsed.helperWorkerIds.length > 0) {
        const insertHelper = db.prepare(`
          INSERT INTO delivery_helpers (id, delivery_id, worker_id) VALUES (?, ?, ?)
        `);
        for (const workerId of parsed.helperWorkerIds) {
          insertHelper.run(crypto.randomUUID(), deliveryId, workerId);
        }
      }

      // 4. Check if transaction is fully delivered
      const remainingAfter = db.prepare(`
        WITH item_remaining AS (
          SELECT 
            ti.item_id,
            ti.quantity - COALESCE(
              (SELECT SUM(di.quantity_delivered) FROM delivery_items di 
               JOIN deliveries d ON di.delivery_id = d.id 
               WHERE d.transaction_id = ? AND di.item_id = ti.item_id), 0
            ) as remaining_qty
          FROM transaction_items ti
          WHERE ti.transaction_id = ?
        )
        SELECT * FROM item_remaining WHERE remaining_qty > 0
      `).all(parsed.transactionId, parsed.transactionId) as { item_id: string, item_name: string, unit: string, ordered_qty: number, delivered_qty: number, remaining_qty: number }[];

      const newStatus = remainingAfter.length === 0 ? 'Fully Delivered' : 'Partially Delivered';
      db.prepare("UPDATE transactions SET delivery_status = ? WHERE id = ?").run(newStatus, parsed.transactionId);

      // 5. Audit log
      db.prepare(`
        INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
        VALUES (?, CURRENT_TIMESTAMP, ?, 'DELIVERY_DISPATCH', ?, NULL, ?)
      `).run(crypto.randomUUID(), userId, deliveryId, `Driver: ${parsed.driverName}, Plate: ${parsed.truckPlate}, Items: ${parsed.items.length}`);
    })();

    return { success: true, data: deliveryId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to dispatch' };
  }
}

// Confirm delivery completion
export async function confirmDelivery(deliveryId: string): Promise<void> {
  const userId = await requireAuth();
  checkMlek();
  db.prepare("UPDATE deliveries SET status = 'Delivered' WHERE id = ?").run(deliveryId);
  db.prepare(`
    INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
    VALUES (?, CURRENT_TIMESTAMP, ?, 'DELIVERY_CONFIRM', ?, 'Dispatched', 'Delivered')
  `).run(crypto.randomUUID(), userId, deliveryId);
}

// Get delivery history for a transaction
export async function getDeliveryHistory(transactionId: string): Promise<{ id: string, transaction_id: string, delivery_date: string, driver_name: string, truck_plate: string, status: string, items: { id: string; delivery_id: string; item_id: string; quantity_delivered: number; item_name: string; unit: string }[] }[]> {
  await requireAuth();
  checkMlek();
  const deliveries = db.prepare(`
    SELECT * FROM deliveries WHERE transaction_id = ? ORDER BY delivery_date DESC
  `).all(transactionId) as { id: string, transaction_id: string, delivery_date: string, driver_name: string, truck_plate: string, status: string }[];

  if (deliveries.length === 0) return [];

  const placeholders = deliveries.map(() => '?').join(',');
  const deliveryIds = deliveries.map(d => d.id);
  
  const allItems = db.prepare(`
    SELECT di.*, i.name as item_name, i.unit 
    FROM delivery_items di
    JOIN inventory i ON di.item_id = i.id
    WHERE di.delivery_id IN (${placeholders})
  `).all(...deliveryIds) as { id: string, delivery_id: string, item_id: string, quantity_delivered: number, item_name: string, unit: string }[];

  const itemsByDelivery = allItems.reduce((acc: Record<string, { id: string; delivery_id: string; item_id: string; quantity_delivered: number; item_name: string; unit: string }[]>, item) => {
    if (!acc[item.delivery_id]) acc[item.delivery_id] = [];
    acc[item.delivery_id].push(item);
    return acc;
  }, {});

  return deliveries.map(del => ({
    ...del,
    items: itemsByDelivery[del.id] || []
  }));
}
