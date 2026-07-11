import { describe, it, expect } from 'vitest';
import { getCustomerLedger } from '../customers';
import { calculateHMACSignature } from '@/lib/ledger_helpers';
import db from '@/lib/db';
import crypto from 'crypto';
import { getMlekSecret, setMlekSecret, isMlekUnlocked } from "@/lib/mlek";
import { getTrialBalance, runDailyGLScan } from '../ledger';

describe('Ledger Actions', () => {
  it('verifies HMAC chain correctly for customers and detects tampering', async () => {
    const customerId = crypto.randomUUID();
    db.prepare(`INSERT INTO customers (id, name, credit_limit, current_balance, is_active, created_at) VALUES (?, 'Test Cust', 1000, 0, 1, CURRENT_TIMESTAMP)`).run(customerId);

    // Insert 2 legitimate ledger entries
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    
    const d1 = new Date().toISOString();
    const entry1 = { id: id1, customer_id: customerId, date: d1, type: 'DEBIT', amount: 500, description: 'Desc 1', reference_id: null };
    const sig1 = calculateHMACSignature(entry1, "GENESIS", getMlekSecret());
    db.prepare(`INSERT INTO customer_ledger (id, customer_id, date, type, amount, reference_id, description, hmac_signature) VALUES (?, ?, ?, 'DEBIT', ?, ?, ?, ?)`).run(id1, customerId, d1, 500, null, 'Desc 1', sig1);

    const d2 = new Date().toISOString();
    const entry2 = { id: id2, customer_id: customerId, date: d2, type: 'CREDIT', amount: 200, description: 'Desc 2', reference_id: null };
    const sig2 = calculateHMACSignature(entry2, sig1, getMlekSecret());
    db.prepare(`INSERT INTO customer_ledger (id, customer_id, date, type, amount, reference_id, description, hmac_signature) VALUES (?, ?, ?, 'CREDIT', ?, ?, ?, ?)`).run(id2, customerId, d2, 200, null, 'Desc 2', sig2);

    const validResult = await getCustomerLedger(customerId);
    expect(validResult.isIntegrityViolated).toBe(false);

    // Tamper with the first entry
    db.prepare(`UPDATE customer_ledger SET amount = 1000 WHERE id = ?`).run(id1);

    const invalidResult = await getCustomerLedger(customerId);
    expect(invalidResult.isIntegrityViolated).toBe(true);
  });
});

describe('Trial Balance & GL Scan', () => {
  it('getTrialBalance returns all accounts', async () => {
    const accounts = await getTrialBalance();
    expect(accounts.length).toBeGreaterThanOrEqual(11);
    const cash = accounts.find(a => a.id === 'acc-cash');
    expect(cash).toBeDefined();
    expect(cash!.code).toBe('1010');
    expect(cash!.category).toBe('Asset');
  });

  it('runDailyGLScan reports clean for balanced entries', async () => {
    const result = await runDailyGLScan();
    expect(result.isCorrupt).toBe(false);
    expect(result.corruptEntries).toEqual([]);
  });

  it('runDailyGLScan detects unbalanced entry', async () => {
    // Insert an unbalanced journal entry
    const jeId = crypto.randomUUID();
    db.prepare(`INSERT INTO journal_entries (id, date, description, created_by) VALUES (?, CURRENT_TIMESTAMP, 'Unbalanced Test', 'system-daemon')`).run(jeId);
    db.prepare(`INSERT INTO journal_lines (id, journal_entry_id, account_id, type, amount) VALUES (?, ?, 'acc-cash', 'DEBIT', 1000)`).run(crypto.randomUUID(), jeId);
    // No matching CREDIT — entry is unbalanced

    const result = await runDailyGLScan();
    expect(result.isCorrupt).toBe(true);
    expect(result.corruptEntries).toContain(jeId);
  });
});
