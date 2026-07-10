import { describe, it, expect } from 'vitest';
import { getCustomerLedger } from '../customers';
import { calculateHMACSignature } from '@/lib/ledger_crypto';
import db from '@/lib/db';
import crypto from 'crypto';
import { getMlekSecret, checkMlek, setMlekSecret, isMlekUnlocked } from "@/lib/mlek";

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
