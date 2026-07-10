import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import db, { runMigrations } from '@/lib/db';
import { getMlekSecret, setMlekSecret, checkMlek } from '@/lib/mlek';
import { processCheckout } from '../transactions';
import { bootstrapStore } from '../unlock';
import { validateAndRestoreBackup } from '../backup';

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

      // Call checkMlek in passive mode
      checkMlek(false);

      // Verify it did not change
      expect(globalThis.mlekLastActivity).toBe(fixedTime);

      // Call checkMlek in active mode
      checkMlek(true);

      // Verify it updated
      expect(globalThis.mlekLastActivity).not.toBe(fixedTime);
      expect(globalThis.mlekLastActivity).toBeGreaterThan(Date.now() - 5000);
    });
  });

  describe('3. Backup Decryption & Validation Checks', () => {
    it('rejects backup restoration if integrity check fails', async () => {
      // Write corrupted ciphertext payload
      const badPayload = Buffer.from("corruptedpayload").toString('base64');
      const res = await validateAndRestoreBackup(badPayload, 'test-user');
      expect(res.success).toBe(false);
    });
  });
});
