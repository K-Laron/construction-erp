"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { Worker } from 'worker_threads';
import path from 'path';

export interface JournalLineInput {
  accountId: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number; // Stored in centavos
}

// Check if store is unlocked
function checkMlek(): void {
  if (!(global as any).mlekSecret) {
    throw new Error("DATABASE_LOCKED: Store is locked.");
  }
}

// General Ledger Transaction: enforces sum(debits) = sum(credits)
export function createBalancedJournalEntry(
  description: string,
  lines: JournalLineInput[],
  createdBy: string = 'system-daemon'
): string {
  checkMlek();

  const totalDebits = lines.filter(l => l.type === 'DEBIT').reduce((sum, l) => sum + l.amount, 0);
  const totalCredits = lines.filter(l => l.type === 'CREDIT').reduce((sum, l) => sum + l.amount, 0);

  if (totalDebits !== totalCredits) {
    throw new Error(`Double-Entry Bookkeeping Error: Total Debits (${totalDebits}) must equal Total Credits (${totalCredits}).`);
  }

  const entryId = crypto.randomUUID();

  const executeTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO journal_entries (id, date, description, created_by)
      VALUES (?, datetime('now'), ?, ?)
    `).run(entryId, description, createdBy);

    const insertLine = db.prepare(`
      INSERT INTO journal_lines (id, journal_entry_id, account_id, type, amount)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateAccount = db.prepare(`
      UPDATE accounts 
      SET balance = balance + ? 
      WHERE id = ?
    `);

    for (const line of lines) {
      const lineId = crypto.randomUUID();
      insertLine.run(lineId, entryId, line.accountId, line.type, line.amount);

      // Debit increases balance for assets/expenses; Credit decreases it
      // Credit increases balance for liabilities/equity/revenue; Debit decreases it
      // We will look up category to update account balance accurately:
      const account = db.prepare("SELECT category FROM accounts WHERE id = ?").get(line.accountId) as { category: string };
      let delta = 0;
      
      if (account.category === 'Asset' || account.category === 'Expense') {
        delta = line.type === 'DEBIT' ? line.amount : -line.amount;
      } else {
        delta = line.type === 'CREDIT' ? line.amount : -line.amount;
      }

      updateAccount.run(delta, line.accountId);
    }
  });

  executeTx();
  return entryId;
}

// Fetch all G/L accounts
export async function getTrialBalance(): Promise<any[]> {
  checkMlek();
  return db.prepare("SELECT * FROM accounts ORDER BY code ASC").all();
}

// Daily G/L Integrity Scan: asserts that all entries are balanced
export async function runDailyGLScan(): Promise<{ isCorrupt: boolean; corruptEntries: string[] }> {
  checkMlek();
  const rows = db.prepare(`
    SELECT journal_entry_id, 
           SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE -amount END) as diff
    FROM journal_lines
    GROUP BY journal_entry_id
    HAVING diff != 0
  `).all() as any[];

  if (rows.length > 0) {
    const ids = rows.map(r => r.journal_entry_id);
    return { isCorrupt: true, corruptEntries: ids };
  }

  return { isCorrupt: false, corruptEntries: [] };
}

// Predefined safe audit queries
const REPORT_QUERIES: Record<string, string> = {
  'TODAY_SALES': "SELECT COALESCE(SUM(total_amount), 0) as total FROM transactions WHERE date(date) = date('now')",
  'TODAY_COLLECTIONS': "SELECT COALESCE(SUM(amount), 0) as total FROM customer_ledger WHERE type = 'CREDIT' AND date(date) = date('now')"
};

// Offload heavy queries to read-only worker threads to prevent main loop blocks
export async function runHeavyAuditReport(reportType: 'TODAY_SALES' | 'TODAY_COLLECTIONS', params: any[] = []): Promise<any[]> {
  checkMlek();
  
  const query = REPORT_QUERIES[reportType];
  if (!query) {
    throw new Error(`Invalid report type: ${reportType}`);
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(process.cwd(), 'src/lib/workers/reportQuery.js'), {
      workerData: { query, params }
    });
    
    worker.on('message', (msg) => {
      if (msg.success) resolve(msg.rows);
      else reject(new Error(msg.error));
    });
    
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker thread stopped with exit code ${code}`));
    });
  });
}
