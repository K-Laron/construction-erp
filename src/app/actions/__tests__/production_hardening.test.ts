import { describe, it, expect, vi } from 'vitest';
import { getMlekSecret, setMlekSecret, isMlekUnlocked } from '@/lib/mlek';
import { createCustomer } from '../customers';
import { createProduct, deactivateProduct } from '../inventory';
import { openShift } from '../shifts';
import { exportEncryptedBackup } from '../backup';
import { createUser, updateCostPrice, overrideCreditLimit } from '../auth';
import crypto from 'crypto';

describe('Production Hardening Features', () => {
  describe('MLEK Inactivity Timeout', () => {
    it('evicts secret from memory after 30 minutes of inactivity', () => {
      const originalSecret = crypto.randomBytes(32);
      setMlekSecret(originalSecret);
      expect(isMlekUnlocked()).toBe(true);

      // Mock system time to be 31 minutes in the future
      vi.useFakeTimers();
      const thirtyOneMinutes = 31 * 60 * 1000;
      vi.advanceTimersByTime(thirtyOneMinutes);

      expect(() => getMlekSecret()).toThrow('Store locked due to inactivity');
      expect(isMlekUnlocked()).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('Zod Validation Boundaries', () => {
    it('rejects invalid inputs on customer creation', async () => {
      const res = await createCustomer('', null, null, -100, 'InvalidTier' as any);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('rejects invalid inputs on product creation', async () => {
      const res = await createProduct('', 'Masonry', 'pc', -10, 100, 200, 180, 50);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('rejects invalid inputs on open shift', async () => {
      const res = await openShift('user_1', -100);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('rejects invalid inputs on user creation', async () => {
      const res = await createUser('createdBy', 'ab', 'Test User', 'Cashier', '12345');
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('rejects invalid inputs on update cost price', async () => {
      const res = await updateCostPrice('user_1', 'invalid-uuid', -500);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('rejects invalid inputs on override credit limit', async () => {
      const res = await overrideCreditLimit('user_1', 'invalid-uuid', -1000);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('rejects invalid inputs on product deactivation', async () => {
      const res = await deactivateProduct('invalid-uuid');
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe('Backup Integrity Validation', () => {
    it('completes successfully on a healthy database', async () => {
      // Ensure store is unlocked
      setMlekSecret(crypto.randomBytes(32));
      const res = await exportEncryptedBackup();
      expect(res.success).toBe(true);
      expect(res.data).toBeDefined();
    });
  });
});
