import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import db, { runMigrations } from '@/lib/db';
import { getMlekSecret, setMlekSecret } from '@/lib/mlek';
import { processCheckout } from '../transactions';
import { bootstrapStore } from '../unlock';
import { validateAndRestoreBackup, exportEncryptedBackup } from '../backup';

describe('Production Hardening Phase 5 Tests', () => {
  const testSecret = crypto.randomBytes(32);

  beforeAll(async () => {
    setMlekSecret(testSecret);
    await runMigrations(testSecret.toString('hex'));

    // Insert a product into inventory to use in cart checkouts
    db.prepare(`
      INSERT INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active)
      VALUES ('item-uuid-1111-2222', 'Test Cement', 'Building Materials', 'bags', 50000, 15000, 20000, 18000, 5000, 1)
    `).run();
  });

  afterAll(() => {
    setMlekSecret(null);
  });

  describe('1. Targeted Manager Override PIN Checks', () => {
    it('verifies override via targeted username successfully', async () => {
      // 1. Insert mock manager
      const managerId = crypto.randomUUID();
      const managerSalt = crypto.randomBytes(16).toString('hex');
      const managerPin = '654321';
      const managerHash = crypto.pbkdf2Sync(managerPin, managerSalt, 600000, 32, 'sha512').toString('hex');

      db.prepare(`
        INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
        VALUES (?, 'manager_bob', 'Bob Manager', 'Manager', ?, ?, 1, 0)
      `).run(managerId, managerHash, managerSalt);

      // Create a checkout payload requiring manager override due to discount
      const payload = {
        customerId: null,
        cashierId: managerId,
        items: [
          {
            itemId: 'item-uuid-1111-2222',
            name: 'Test Cement',
            quantity: 1000, // 1 bag (millicounts)
            unitUsed: 'bags',
            unitPrice: 20000, // 200.00
            unitCost: 15000,
            totalPrice: 20000
          }
        ],
        subtotal: 20000,
        tax: 1929, // ((20000 - 2000)/1.12)*0.12 rounded
        deliveryFee: 0,
        discount: 2000, // 20.00 discount requires override
        totalAmount: 18000, // subtotal (20000) - discount (2000) = 18000 (VAT inclusive)
        amountPaid: 18000,
        paymentMethod: 'Cash' as const,
        overridePin: managerPin,
        overrideUsername: 'manager_bob'
      };

      const res = await processCheckout(payload);
      expect(res.success).toBe(true);
    });

    it('rejects override if targeted username PIN mismatches', async () => {
      const payload = {
        customerId: null,
        cashierId: 'some-cashier',
        items: [
          {
            itemId: 'item-uuid-1111-2222',
            name: 'Test Cement',
            quantity: 1000,
            unitUsed: 'bags',
            unitPrice: 20000,
            unitCost: 15000,
            totalPrice: 20000
          }
        ],
        subtotal: 20000,
        tax: 1929,
        deliveryFee: 0,
        discount: 2000,
        totalAmount: 18000,
        amountPaid: 18000,
        paymentMethod: 'Cash' as const,
        overridePin: '999999', // Bad PIN
        overrideUsername: 'manager_bob'
      };

      const res = await processCheckout(payload);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Invalid Manager Override PIN");
    });
  });

  describe('2. Passive Inactivity Timer Verification', () => {
    it('does not update global mlekLastActivity when passive check is called', () => {
      // Set timestamp manually to 1 minute ago (safe from 30 minute timeout)
      const fixedTime = Date.now() - 60000;
      globalThis.mlekLastActivity = fixedTime;

      // Call getMlekSecret in passive mode
      getMlekSecret(false);

      // Verify it did not change
      expect(globalThis.mlekLastActivity).toBe(fixedTime);

      // Call getMlekSecret in active mode
      getMlekSecret(true);

      // Verify it updated
      expect(globalThis.mlekLastActivity).not.toBe(fixedTime);
      expect(globalThis.mlekLastActivity).toBeGreaterThan(Date.now() - 5000);
    });
  });

  describe('3. Backup Decryption & Validation Checks', () => {
    it('rejects backup restoration if integrity check fails', async () => {
      // Write corrupted ciphertext payload
      const badPayload = Buffer.from("corruptedpayload").toString('base64');
      const res = await validateAndRestoreBackup(badPayload);
      expect(res.success).toBe(false);
    });

    it('successfully exports and restores backup with active dbProxy (H1)', async () => {
      // 1. Export backup
      const exportRes = await exportEncryptedBackup();
      expect(exportRes.success).toBe(true);
      expect(exportRes.data).toBeDefined();

      // 2. Restore backup
      const restoreRes = await validateAndRestoreBackup(exportRes.data!);
      if (!restoreRes.success) {
        console.log("RESTORE ERROR DETAIL:", restoreRes.error);
      }
      expect(restoreRes.success).toBe(true);

      // 3. Verify database connection is still active and working (not closed error)
      const row = db.prepare("SELECT 1 as val").get() as { val: number };
      expect(row.val).toBe(1);
    });
  });

  describe('4. Supplier Ledger HMAC Repair Migration (C1 & Migration 7)', () => {
    it('successfully repairs buggy supplier ledger HMAC signatures', async () => {
      const supplierId = crypto.randomUUID();
      db.prepare(`INSERT INTO suppliers (id, name, contact_person, phone, email, current_balance, is_active) VALUES (?, 'Repair Supplier', null, null, null, 1000, 1)`).run(supplierId);

      const entryId = crypto.randomUUID();
      const dateStr = new Date().toISOString();
      const prevSig = "GENESIS";
      
      // Calculate buggy signature (using '' instead of supplierId)
      const buggyData = `${entryId}-${''}-${1000}-CHARGE-${dateStr}-ref1-desc1--${prevSig}`;
      const buggySig = crypto.createHmac('sha256', testSecret).update(buggyData).digest('hex');

      db.prepare(`
        INSERT INTO supplier_ledger (id, supplier_id, date, type, amount, reference_id, description, hmac_signature)
        VALUES (?, ?, ?, 'CHARGE', ?, 'ref1', 'desc1', ?)
      `).run(entryId, supplierId, dateStr, 1000, buggySig);

      // Verify it is currently failing integrity check (before repair migration 7 is run)
      const { getSupplierLedger } = await import('../inventory');
      const verifyBefore = await getSupplierLedger(supplierId);
      expect(verifyBefore.isIntegrityViolated).toBe(true);

      // Programmatically run migration 007 (by calling runMigrations again)
      // Delete version 7 first so the runner executes it on our new test row
      db.prepare("DELETE FROM schema_migrations WHERE version = 7").run();
      await runMigrations(testSecret.toString('hex'));

      // Verify it is now valid (integrity violation resolved)
      const verifyAfter = await getSupplierLedger(supplierId);
      expect(verifyAfter.isIntegrityViolated).toBe(false);
      expect(verifyAfter.ledger[0].hmac_signature).not.toBe(buggySig);
    });
  });

  describe('5. Timestamp Standardization Migration (N4 & Migration 8)', () => {
    it('standardizes mixed date formats to ISO-8601 and maintains correct chronological sorting', async () => {
      const tx1Id = crypto.randomUUID();
      const tx2Id = crypto.randomUUID();
      
      // Insert old format that is chronologically later: 12:00
      db.prepare(`
        INSERT INTO transactions (id, cashier_id, date, subtotal, tax, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status)
        VALUES (?, 'system-daemon', '2026-07-11 12:00:00', 1000, 0, 1000, 1000, 0, 'Paid', 'Cash', 'N/A')
      `).run(tx1Id);

      // Insert new format that is chronologically earlier: 10:00
      db.prepare(`
        INSERT INTO transactions (id, cashier_id, date, subtotal, tax, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status)
        VALUES (?, 'system-daemon', '2026-07-11T10:00:00.000Z', 1000, 0, 1000, 1000, 0, 'Paid', 'Cash', 'N/A')
      `).run(tx2Id);

      // Verify lexicographical order before migration (incorrect sorting due to space vs 'T')
      const beforeSort = db.prepare("SELECT id FROM transactions WHERE id IN (?, ?) ORDER BY date ASC").all(tx1Id, tx2Id) as { id: string }[];
      expect(beforeSort[0].id).toBe(tx1Id);

      // Run migration 8
      db.prepare("DELETE FROM schema_migrations WHERE version = 8").run();
      await runMigrations(testSecret.toString('hex'));

      // Verify format updated to ISO-8601
      const tx1After = db.prepare("SELECT date FROM transactions WHERE id = ?").get(tx1Id) as { date: string };
      expect(tx1After.date).toBe('2026-07-11T12:00:00.000Z');

      // Verify correct sorting now
      const afterSort = db.prepare("SELECT id FROM transactions WHERE id IN (?, ?) ORDER BY date ASC").all(tx1Id, tx2Id) as { id: string }[];
      expect(afterSort[0].id).toBe(tx2Id);
    });
  });
});
