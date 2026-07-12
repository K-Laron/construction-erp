import db from '@/lib/db';
import crypto from 'crypto';
import { getMlekSecret } from "@/lib/mlek";

// Calculate the HMAC signature for a ledger entry
export function calculateHMACSignature(
  entry: { 
    id: string; 
    customer_id?: string; 
    supplier_id?: string; 
    amount: number; 
    type: string; 
    date?: string;
    reference_id?: string | null;
    description?: string | null;
    cashier_id?: string | null;
  }, 
  prevSig: string,
  mlekSecret: Buffer
): string {
  const entityId = entry.customer_id || entry.supplier_id || '';
  const dateStr = entry.date || '';
  const refId = entry.reference_id || '';
  const desc = entry.description || '';
  const cashier = entry.cashier_id || '';
  const data = `${entry.id}-${entityId}-${entry.amount}-${entry.type}-${dateStr}-${refId}-${desc}-${cashier}-${prevSig}`;
  return crypto.createHmac('sha256', mlekSecret).update(data).digest('hex');
}

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
  getMlekSecret();

  const totalDebits = lines.filter(l => l.type === 'DEBIT').reduce((sum, l) => sum + l.amount, 0);
  const totalCredits = lines.filter(l => l.type === 'CREDIT').reduce((sum, l) => sum + l.amount, 0);

  if (totalDebits !== totalCredits) {
    throw new Error(`Double-Entry Bookkeeping Error: Total Debits (${totalDebits}) must equal Total Credits (${totalCredits}).`);
  }

  const entryId = crypto.randomUUID();

  const executeTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO journal_entries (id, date, description, created_by)
      VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?)
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
