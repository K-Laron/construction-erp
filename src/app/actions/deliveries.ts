"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { getActiveUserId } from './auth';
import { getMlekSecret, checkMlek, setMlekSecret, isMlekUnlocked } from "@/lib/mlek";


// Fetch pending deliveries
export async function getPendingDeliveries(): Promise<any[]> {
  checkMlek();
  return db.prepare(`
    SELECT t.id as transaction_id, t.date, t.delivery_status,
           c.name as customer_name, c.id as customer_id,
           t.total_amount
    FROM transactions t
    LEFT JOIN customers c ON t.customer_id = c.id
    WHERE t.delivery_status IN ('Pending', 'Partially Delivered')
    ORDER BY t.date ASC
  `).all();
}

// Fetch items remaining for a transaction
export async function getDeliveryRemainingItems(transactionId: string): Promise<any[]> {
  checkMlek();

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
  `).all(transactionId, transactionId);
}

// Dispatch a delivery trip
export async function dispatchDelivery(
  transactionId: string,
  driverName: string,
  truckPlate: string,
  items: { itemId: string; quantityDelivered: number }[], // millicounts
  helperWorkerIds: string[] = []
): Promise<string> {
  checkMlek();
  const userId = await getActiveUserId();

  const deliveryId = crypto.randomUUID();

  // M2: Validate remaining quantity before dispatching
  const remaining = await getDeliveryRemainingItems(transactionId);
  for (const item of items) {
    const rem = remaining.find(r => r.item_id === item.itemId);
    if (!rem) throw new Error(`Item ${item.itemId} is not part of this transaction.`);
    if (item.quantityDelivered > rem.remaining_qty) {
      throw new Error(`DISPATCH_EXCEEDS_REMAINING: Item ${item.itemId} remaining is ${rem.remaining_qty}, but trying to dispatch ${item.quantityDelivered}.`);
    }
  }

  db.transaction(() => {
    // 1. Create delivery record
    db.prepare(`
      INSERT INTO deliveries (id, transaction_id, delivery_date, driver_name, truck_plate, status)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, 'Dispatched')
    `).run(deliveryId, transactionId, driverName, truckPlate);

    // 2. Insert delivery items
    const insertItem = db.prepare(`
      INSERT INTO delivery_items (id, delivery_id, item_id, quantity_delivered)
      VALUES (?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(crypto.randomUUID(), deliveryId, item.itemId, item.quantityDelivered);
    }

    // 3. Assign helpers
    if (helperWorkerIds.length > 0) {
      const insertHelper = db.prepare(`
        INSERT INTO delivery_helpers (id, delivery_id, worker_id) VALUES (?, ?, ?)
      `);
      for (const workerId of helperWorkerIds) {
        insertHelper.run(crypto.randomUUID(), deliveryId, workerId);
      }
    }

    // 4. Check if transaction is fully delivered
    const remaining = db.prepare(`
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
    `).all(transactionId, transactionId);

    const newStatus = remaining.length === 0 ? 'Fully Delivered' : 'Partially Delivered';
    db.prepare("UPDATE transactions SET delivery_status = ? WHERE id = ?").run(newStatus, transactionId);

    // 5. Audit log
    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, CURRENT_TIMESTAMP, ?, 'DELIVERY_DISPATCH', ?, NULL, ?)
    `).run(crypto.randomUUID(), userId, deliveryId, `Driver: ${driverName}, Plate: ${truckPlate}, Items: ${items.length}`);
  })();

  return deliveryId;
}

// Confirm delivery completion
export async function confirmDelivery(deliveryId: string): Promise<void> {
  checkMlek();
  db.prepare("UPDATE deliveries SET status = 'Delivered' WHERE id = ?").run(deliveryId);
}

// Get delivery history for a transaction
export async function getDeliveryHistory(transactionId: string): Promise<any[]> {
  checkMlek();
  const deliveries = db.prepare(`
    SELECT * FROM deliveries WHERE transaction_id = ? ORDER BY delivery_date DESC
  `).all(transactionId) as any[];

  if (deliveries.length === 0) return [];

  const placeholders = deliveries.map(() => '?').join(',');
  const deliveryIds = deliveries.map(d => d.id);
  
  const allItems = db.prepare(`
    SELECT di.*, i.name as item_name, i.unit 
    FROM delivery_items di
    JOIN inventory i ON di.item_id = i.id
    WHERE di.delivery_id IN (${placeholders})
  `).all(...deliveryIds) as any[];

  const itemsByDelivery = allItems.reduce((acc, item) => {
    if (!acc[item.delivery_id]) acc[item.delivery_id] = [];
    acc[item.delivery_id].push(item);
    return acc;
  }, {});

  return deliveries.map(del => ({
    ...del,
    items: itemsByDelivery[del.id] || []
  }));
}
