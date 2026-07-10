import db from '@/lib/db';
import crypto from 'crypto';
import { checkMlek } from "@/lib/mlek";

export interface JournalLineInput {
  accountId: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number; // Stored in centavos
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
      VALUES (?, CURRENT_TIMESTAMP, ?, ?)
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
      const account = db.prepare("SELECT category FROM accounts WHERE id = ?").get(line.accountId) as { category: string } | undefined;
      if (!account) {
        throw new Error(`ACCOUNT_NOT_FOUND: G/L Account '${line.accountId}' does not exist.`);
      }
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
