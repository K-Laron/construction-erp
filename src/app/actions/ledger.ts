"use server";

import db from '@/lib/db';
import { Worker } from 'worker_threads';
import path from 'path';
import { checkMlek } from "@/lib/mlek";

// Fetch all G/L accounts
export async function getTrialBalance(): Promise<{ id: string; code: string; name: string; category: string; balance: number }[]> {
  checkMlek();
  return db.prepare("SELECT * FROM accounts ORDER BY code ASC").all() as { id: string; code: string; name: string; category: string; balance: number }[];
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
  `).all() as { journal_entry_id: string, diff: number }[];

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
export async function runHeavyAuditReport(reportType: 'TODAY_SALES' | 'TODAY_COLLECTIONS', params: any[] = []): Promise<{ total: number }[]> {
  checkMlek();
  
  const query = REPORT_QUERIES[reportType];
  if (!query) {
    throw new Error(`Invalid report type: ${reportType}`);
  }

  // M5 Fix: Skip worker thread if running on an in-memory database (tests)
  if (db.memory) {
    return db.prepare(query).all(...params) as { total: number }[];
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(process.cwd(), 'src/lib/workers/reportQuery.js'), {
      workerData: { query, params, dbPath: db.name }
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
