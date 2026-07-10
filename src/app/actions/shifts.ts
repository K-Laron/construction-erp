"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { getActiveUserId } from './auth';
import { checkMlek } from "@/lib/mlek";


// Open a new cashier shift
export async function openShift(_ignoredCashierId: string, openingFloat: number): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
  checkMlek();
  const cashierId = await getActiveUserId();

  // Only one open shift per cashier
  const existing = db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND status = 'Open' LIMIT 1").get(cashierId) as { id: string } | undefined;
  if (existing) {
    throw new Error("SHIFT_ALREADY_OPEN: Close the current shift before opening a new one.");
  }

  const shiftId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO shifts (id, cashier_id, opened_at, opening_float, status)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'Open')
  `).run(shiftId, cashierId, openingFloat);

    return { success: true, data: shiftId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to open shift' };
  }
}

// Close a shift and generate Z-Reading
export async function closeShift(shiftId: string, actualCash: number): Promise<{ success: boolean; data?: { zReadingId: string; discrepancy: number }; error?: string }> {
  try {
  checkMlek();

  const shift = db.prepare("SELECT * FROM shifts WHERE id = ? AND status = 'Open'").get(shiftId) as { id: string, cashier_id: string, opened_at: string, opening_float: number, status: string } | undefined;
  if (!shift) {
    throw new Error("SHIFT_NOT_FOUND: No open shift found with that ID.");
  }

  const cashSales = db.prepare(`
    SELECT COALESCE(SUM(amount_paid), 0) as total
    FROM transactions
    WHERE cashier_id = ? AND payment_method = 'Cash' AND date >= ? AND date <= CURRENT_TIMESTAMP
  `).get(shift.cashier_id, shift.opened_at) as { total: number };

  const collections = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM customer_ledger 
    WHERE type = 'CREDIT' AND cashier_id = ? AND date >= ? AND date <= CURRENT_TIMESTAMP
  `).get(shift.cashier_id, shift.opened_at) as { total: number };

  const expectedCash = shift.opening_float + cashSales.total + collections.total;
  const discrepancy = actualCash - expectedCash;
  const zReadingId = crypto.randomUUID();

  db.transaction(() => {
    // 1. Close the shift
    db.prepare(`
      UPDATE shifts SET closed_at = CURRENT_TIMESTAMP, closing_cash_actual = ?, status = 'Closed', z_reading_id = ?
      WHERE id = ?
    `).run(actualCash, zReadingId, shiftId);

    // 2. Compute Z-Reading aggregates
    // Transactions during this shift (between start_time and now, by this cashier)
    const salesAgg = db.prepare(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as gross_sales,
        COALESCE(SUM(tax), 0) as vat_collected,
        COALESCE(SUM(CASE WHEN tax > 0 THEN subtotal - tax ELSE 0 END), 0) as vatable_sales,
        COALESCE(SUM(CASE WHEN tax = 0 THEN subtotal ELSE 0 END), 0) as exempt_sales
      FROM transactions 
      WHERE cashier_id = ? AND date >= ? AND date <= CURRENT_TIMESTAMP
    `).get(shift.cashier_id, shift.opened_at) as { gross_sales: number, vat_collected: number, vatable_sales: number, exempt_sales: number };

    // N3: Count voids and returns separately
    const voidsCount = db.prepare(`
      SELECT COALESCE(COUNT(*), 0) as total
      FROM system_audit_logs
      WHERE action_type = 'SALE_VOID' AND timestamp >= ? AND timestamp <= CURRENT_TIMESTAMP AND user_id = ?
    `).get(shift.opened_at, shift.cashier_id) as { total: number };

    const returnsCount = db.prepare(`
      SELECT COALESCE(COUNT(*), 0) as total
      FROM system_audit_logs
      WHERE action_type = 'SALE_RETURN' AND timestamp >= ? AND timestamp <= CURRENT_TIMESTAMP AND user_id = ?
    `).get(shift.opened_at, shift.cashier_id) as { total: number };

    // Collections already calculated above

    db.prepare(`
      INSERT INTO shift_z_readings (id, shift_id, date, gross_sales, vat_collected, vatable_sales, exempt_sales, total_voids, total_returns, total_collections)
      VALUES (?, ?, date('now'), ?, ?, ?, ?, ?, ?, ?)
    `).run(
      zReadingId, shiftId,
      salesAgg.gross_sales, salesAgg.vat_collected,
      salesAgg.vatable_sales, salesAgg.exempt_sales,
      voidsCount.total, returnsCount.total, collections.total
    );

    // 3. Audit log
    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, CURRENT_TIMESTAMP, ?, 'SHIFT_CLOSE', ?, ?, ?)
    `).run(crypto.randomUUID(), shift.cashier_id, shiftId, `Expected: ${expectedCash}`, `Actual: ${actualCash}, Disc: ${discrepancy}`);
  })();

  return { success: true, data: { zReadingId, discrepancy } };
} catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to close shift' };
  }
}

// Get the current open shift for a cashier
export async function getCurrentShift(_ignoredCashierId: string): Promise<any | null> {
  checkMlek();
  const cashierId = await getActiveUserId();
  return db.prepare("SELECT * FROM shifts WHERE cashier_id = ? AND status = 'Open' LIMIT 1").get(cashierId) || null;
}

// Get Z-Reading for a closed shift
export async function getZReading(shiftId: string): Promise<any | null> {
  checkMlek();
  return db.prepare("SELECT * FROM shift_z_readings WHERE shift_id = ?").get(shiftId) || null;
}

// Get all shifts (paginated)
export async function getShiftHistory(limit: number = 50, offset: number = 0): Promise<any[]> {
  checkMlek();
  return db.prepare(`
    SELECT s.*, u.name as cashier_name 
    FROM shifts s 
    JOIN users u ON s.cashier_id = u.id 
    ORDER BY s.opened_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}
