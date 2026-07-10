"use server";

import db from '@/lib/db';
import { encryptField, decryptField } from '@/lib/crypto';
import { Customer, CustomerLedgerEntry } from '@/types';
import crypto from 'crypto';
import { calculateHMACSignature } from '@/lib/ledger_crypto';
import { createBalancedJournalEntry } from '@/lib/ledger_helpers';
import { getActiveUserId } from './auth';
import { getMlekSecret } from "@/lib/mlek";
import { z } from 'zod';

const CreateCustomerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  creditLimit: z.number().int().nonnegative(),
  priceTier: z.enum(['Retail', 'Wholesale']).default('Retail'),
  isVatExempt: z.number().int().min(0).max(1).default(0)
});

const DeactivateCustomerSchema = z.object({
  customerId: z.string().uuid()
});

// Removed local getMlekSecret
// Fetch all active customers
export async function getCustomers(): Promise<Customer[]> {
  const secret = getMlekSecret(false);
  const rows = db.prepare("SELECT * FROM customers WHERE is_active = 1 ORDER BY name ASC").all() as Customer[];

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone ? decryptField(r.phone, secret) : null,
    address: r.address ? decryptField(r.address, secret) : null,
    credit_limit: r.credit_limit,
    current_balance: r.current_balance,
    price_tier: r.price_tier,
    is_vat_exempt: r.is_vat_exempt,
    is_active: r.is_active,
    created_at: r.created_at
  }));
}

// Create a new customer
export async function createCustomer(
  name: string,
  phone: string | null,
  address: string | null,
  creditLimit: number, // In centavos
  priceTier: 'Retail' | 'Wholesale' = 'Retail',
  isVatExempt: number = 0
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const parsed = CreateCustomerSchema.parse({ name, phone, address, creditLimit, priceTier, isVatExempt });
    const secret = getMlekSecret();
    const customerId = crypto.randomUUID();

    const encryptedPhone = parsed.phone ? encryptField(parsed.phone, secret) : null;
    const encryptedAddress = parsed.address ? encryptField(parsed.address, secret) : null;

    db.prepare(`
      INSERT INTO customers (id, name, phone, address, credit_limit, current_balance, price_tier, is_vat_exempt, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, CURRENT_TIMESTAMP)
    `).run(customerId, parsed.name, encryptedPhone, encryptedAddress, parsed.creditLimit, parsed.priceTier, parsed.isVatExempt);

    return { success: true, data: customerId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create customer' };
  }
}

// Soft delete customer
export async function deactivateCustomer(customerId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = DeactivateCustomerSchema.parse({ customerId });
    getMlekSecret(); // Ensure unlocked
    const info = db.prepare("UPDATE customers SET is_active = 0 WHERE id = ?").run(parsed.customerId);
    if (info.changes === 0) throw new Error("Customer not found");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Retrieve customer ledger and check HMAC signature validity
export async function getCustomerLedger(customerId: string): Promise<{ ledger: CustomerLedgerEntry[]; isIntegrityViolated: boolean }> {
  getMlekSecret(false); // Ensure unlocked
  const rows = db.prepare("SELECT * FROM customer_ledger WHERE customer_id = ? ORDER BY date ASC").all(customerId) as CustomerLedgerEntry[];

  let prevSig = "GENESIS";
  let isIntegrityViolated = false;

  for (const entry of rows) {
    const expectedSig = calculateHMACSignature(entry, prevSig, getMlekSecret());
    if (entry.hmac_signature !== expectedSig) {
      isIntegrityViolated = true;
    }
    prevSig = entry.hmac_signature || "CORRUPT";
  }

  return { ledger: rows, isIntegrityViolated };
}

const RecordPaymentSchema = z.object({
  customerId: z.string().uuid(),
  amount: z.number().int().positive(),
  description: z.string().min(1)
});

// Receive cash payment and post credit ledger entry
export async function recordPayment(customerId: string, amount: number, description: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const parsed = RecordPaymentSchema.parse({ customerId, amount, description });
    const ledgerId = crypto.randomUUID();
    const cashierId = await getActiveUserId();
    
    db.transaction(() => {
      // 1. Update customer current balance (decrease outstanding A/R)
      db.prepare(`
        UPDATE customers SET current_balance = current_balance - ? WHERE id = ?
      `).run(parsed.amount, parsed.customerId);

      // 2. Fetch previous ledger entry's signature for chaining
      const lastEntry = db.prepare(`
        SELECT hmac_signature FROM customer_ledger 
        WHERE customer_id = ? ORDER BY date DESC LIMIT 1
      `).get(parsed.customerId) as { hmac_signature: string } | undefined;
      
      const prevSig = lastEntry ? lastEntry.hmac_signature : "GENESIS";

      // 3. Insert credit ledger entry
      const entryData = {
        id: ledgerId,
        customer_id: parsed.customerId,
        date: new Date().toISOString(),
        type: 'CREDIT' as const,
        amount: parsed.amount,
        reference_id: null,
        description: parsed.description
      };

      const signature = calculateHMACSignature(entryData, prevSig, getMlekSecret());

      db.prepare(`
        INSERT INTO customer_ledger (id, customer_id, date, type, amount, reference_id, description, hmac_signature, cashier_id)
        VALUES (?, ?, ?, 'CREDIT', ?, NULL, ?, ?, ?)
      `).run(ledgerId, parsed.customerId, entryData.date, parsed.amount, parsed.description, signature, cashierId);

      // 4. Record G/L Journal Entry
      // Debit Cash Drawer (1010) - Cash increases
      // Credit Accounts Receivable (1110) - Customer debt decreases
      createBalancedJournalEntry(
        `Received payment from customer: ${parsed.customerId}`,
        [
          { accountId: 'acc-cash', type: 'DEBIT', amount: parsed.amount },
          { accountId: 'acc-ar', type: 'CREDIT', amount: parsed.amount }
        ],
        cashierId
      );
    })();

    return { success: true, data: ledgerId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to record payment' };
  }
}
