"use server";

import db from '@/lib/db';
import { getMlekSecret } from "@/lib/mlek";
import { requireAuth } from './auth';

// Fetch all G/L accounts
export async function getTrialBalance(): Promise<{ id: string; code: string; name: string; category: string; balance: number }[]> {
  await requireAuth();
  getMlekSecret(false);
  return db.prepare("SELECT * FROM accounts ORDER BY code ASC").all() as { id: string; code: string; name: string; category: string; balance: number }[];
}

// Daily G/L Integrity Scan: asserts that all entries are balanced
export async function runDailyGLScan(): Promise<{ isCorrupt: boolean; corruptEntries: string[] }> {
  await requireAuth(['Manager', 'Admin']);
  getMlekSecret(false);
  const rows = db.prepare(`
    SELECT journal_entry_id, 
           SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE -amount END) as diff
    FROM journal_lines
    GROUP BY journal_entry_id
    HAVING diff != 0
  `).all() as { journal_entry_id: string, diff: number }[];

  if (rows.length > 0) {
    const ids = rows.map(r => r.journal_entry_id);
    return { isCorrupt: true, corruptEntries: ids };
  }

  return { isCorrupt: false, corruptEntries: [] };
}

export async function getTodaySales(): Promise<number> {
  await requireAuth(['Manager', 'Admin']);
  getMlekSecret(false);
  const row = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM transactions WHERE date(date) = date('now')").get() as { total: number };
  return row.total;
}

export async function getTodayCollections(): Promise<number> {
  await requireAuth(['Manager', 'Admin']);
  getMlekSecret(false);
  const row = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM customer_ledger WHERE type = 'CREDIT' AND date(date) = date('now')").get() as { total: number };
  return row.total;
}
