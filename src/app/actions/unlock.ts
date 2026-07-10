"use server";

import db, { runMigrations } from '@/lib/db';
import { deriveKey, encryptField, decryptField } from '@/lib/crypto';
import crypto from 'crypto';
import { setMlekSecret, isMlekUnlocked } from "@/lib/mlek";

export interface UnlockResult {
  success: boolean;
  error?: string;
  isFirstBoot?: boolean;
  adminPin?: string;
}

// Check if store is already unlocked in process memory
export async function isStoreUnlocked(): Promise<boolean> {
  return isMlekUnlocked();
}

// Check if this is the first boot (config keys missing)
export async function checkFirstBoot(): Promise<boolean> {
  const row = db.prepare("SELECT 1 FROM system_config WHERE key = 'mlek_encrypted_dop'").get();
  return !row;
}

// Bootstrap the store configuration (first-time setup)
export async function bootstrapStore(dop: string, mmpWords: string[]): Promise<UnlockResult> {
  if (mmpWords.length !== 12) {
    return { success: false, error: "Disaster recovery mnemonic must be exactly 12 words." };
  }

  const mmp = mmpWords.join(' ');

  // Enforce DOP entropy checks
  if (dop.length < 14) {
    return { success: false, error: "DOP must be at least 14 characters long." };
  }
  const hasLower = /[a-z]/.test(dop);
  const hasUpper = /[A-Z]/.test(dop);
  const hasDigit = /\d/.test(dop);
  const hasSpecial = /[^A-Za-z0-9]/.test(dop);
  if ((hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0) < 3) {
    return { success: false, error: "DOP must contain at least three of: lowercase, uppercase, digits, or symbols." };
  }

  try {
    const isConfigured = await checkFirstBoot();
    if (!isConfigured) {
      return { success: false, error: "Store is already bootstrapped." };
    }

    // Generate Master Ledger Encryption Key (MLEK)
    const mlek = crypto.randomBytes(32); // 256 bits

    // Generate salts
    const dopSalt = crypto.randomBytes(16).toString('hex');
    const mmpSalt = crypto.randomBytes(16).toString('hex');

    // Derive keys
    const dopKey = await deriveKey(dop, dopSalt, 100000);
    const mmpKey = await deriveKey(mmp, mmpSalt, 600000);

    // Encrypt MLEK under DOP and MMP
    const mlekHex = mlek.toString('hex');
    const encryptedDop = encryptField(mlekHex, dopKey);
    const encryptedMmp = encryptField(mlekHex, mmpKey);

    let adminPin = '';

    db.transaction(() => {
      // Save config
      const insertConfig = db.prepare("INSERT INTO system_config (key, value) VALUES (?, ?)");
      insertConfig.run('mlek_encrypted_dop', encryptedDop);
      insertConfig.run('mlek_encrypted_mmp', encryptedMmp);
      insertConfig.run('dop_salt', dopSalt);
      insertConfig.run('mmp_salt', mmpSalt);

      // Seed default admin user (username: admin, PIN: 6-digit random)
      const adminSalt = crypto.randomBytes(16).toString('hex');
      adminPin = Array.from({length: 6}, () => Math.floor(Math.random() * 10)).join('');
      const adminHash = crypto.pbkdf2Sync(adminPin, adminSalt, 600000, 32, 'sha512').toString('hex');

      db.prepare(`
        INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
        VALUES (?, ?, ?, ?, ?, ?, 1, 0)
      `).run(crypto.randomUUID(), 'admin', 'Store Admin', 'Admin', adminHash, adminSalt);
    })();

    // Load MLEK into process memory
    setMlekSecret(mlek);

    return { success: true, adminPin };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Unlock the database using the DOP passphrase
export async function unlockStore(dop: string, ipAddress: string = '127.0.0.1'): Promise<UnlockResult> {
  const isFirst = await checkFirstBoot();
  if (isFirst) {
    return { success: false, error: "Store is not yet initialized. Please complete setup.", isFirstBoot: true };
  }

  const timeframe5Min = Date.now() - 300000;
  const timeframe15Min = Date.now() - 900000;

  // 1. IP Lockout Throttling Check
  const ipFailCount = db.prepare(`
    SELECT COUNT(*) as count FROM login_attempts 
    WHERE attempt_type = 'DOP' AND ip_address = ? AND is_successful = 0 AND timestamp > ?
  `).get(ipAddress, timeframe5Min) as { count: number };

  if (ipFailCount.count >= 3) {
    return { success: false, error: "IP temporarily locked out. Try again in 5 minutes." };
  }


  try {
    const dopConfig = db.prepare("SELECT value FROM system_config WHERE key = 'mlek_encrypted_dop'").get() as { value: string };
    const dopSalt = db.prepare("SELECT value FROM system_config WHERE key = 'dop_salt'").get() as { value: string };

    const derivedKey = await deriveKey(dop, dopSalt.value, 100000);
    const decryptedMlek = decryptField(dopConfig.value, derivedKey);

    // Save decrypted key in server memory
    setMlekSecret(Buffer.from(decryptedMlek, 'hex'));

    // Run programmatic JS migrations
    await runMigrations(decryptedMlek);

    // Log successful attempt
    db.prepare(`
      INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful)
      VALUES (?, 'DOP', '/api/unlock-store', ?, ?, 1)
    `).run(crypto.randomUUID(), ipAddress, Date.now());

    return { success: true };
  } catch (err) {
    // Log failed attempt
    db.prepare(`
      INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful)
      VALUES (?, 'DOP', '/api/unlock-store', ?, ?, 0)
    `).run(crypto.randomUUID(), ipAddress, Date.now());

    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, CURRENT_TIMESTAMP, NULL, 'STORE_UNLOCK_FAILED', NULL, NULL, ?)
    `).run(crypto.randomUUID(), ipAddress);

    return { success: false, error: "Invalid Daily Operational Passphrase." };
  }
}

// Disaster Recovery using the 12-word MMP recovery mnemonic
export async function recoverStore(mnemonicWords: string[], newDop: string, ipAddress: string = '127.0.0.1'): Promise<UnlockResult> {
  if (mnemonicWords.length !== 12) {
    return { success: false, error: "Disaster recovery mnemonic must be exactly 12 words." };
  }

  const mmp = mnemonicWords.join(' ');

  // DOP Complexity Check
  if (newDop.length < 14) {
    return { success: false, error: "New DOP must be at least 14 characters long." };
  }

  const timeframe5Min = Date.now() - 300000;
  const timeframe15Min = Date.now() - 900000;

  // IP Lockout check
  const ipFailCount = db.prepare(`
    SELECT COUNT(*) as count FROM login_attempts 
    WHERE attempt_type = 'MMP' AND ip_address = ? AND is_successful = 0 AND timestamp > ?
  `).get(ipAddress, timeframe5Min) as { count: number };

  if (ipFailCount.count >= 3) {
    return { success: false, error: "IP temporarily locked out from recovery. Try again in 5 minutes." };
  }


  try {
    const mmpConfig = db.prepare("SELECT value FROM system_config WHERE key = 'mlek_encrypted_mmp'").get() as { value: string };
    const mmpSalt = db.prepare("SELECT value FROM system_config WHERE key = 'mmp_salt'").get() as { value: string };

    const derivedMmpKey = await deriveKey(mmp, mmpSalt.value, 600000);
    const decryptedMlek = decryptField(mmpConfig.value, derivedMmpKey);

    // Decryption succeeded! Update the DOP
    const newDopSalt = crypto.randomBytes(16).toString('hex');
    const derivedDopKey = await deriveKey(newDop, newDopSalt, 100000);
    const encryptedDop = encryptField(decryptedMlek, derivedDopKey);

    db.transaction(() => {
      db.prepare("UPDATE system_config SET value = ? WHERE key = 'mlek_encrypted_dop'").run(encryptedDop);
      db.prepare("UPDATE system_config SET value = ? WHERE key = 'dop_salt'").run(newDopSalt);
    })();

    // Set MLEK in memory
    setMlekSecret(Buffer.from(decryptedMlek, 'hex'));

    db.prepare(`
      INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful)
      VALUES (?, 'MMP', '/api/recover-store', ?, ?, 1)
    `).run(crypto.randomUUID(), ipAddress, Date.now());

    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, CURRENT_TIMESTAMP, NULL, 'STORE_RECOVERY_SUCCESS', NULL, NULL, ?)
    `).run(crypto.randomUUID(), ipAddress);

    return { success: true };
  } catch (err) {
    db.prepare(`
      INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful)
      VALUES (?, 'MMP', '/api/recover-store', ?, ?, 0)
    `).run(crypto.randomUUID(), ipAddress, Date.now());

    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, CURRENT_TIMESTAMP, NULL, 'STORE_RECOVERY_FAILED', NULL, NULL, ?)
    `).run(crypto.randomUUID(), ipAddress);

    return { success: false, error: "Invalid Recovery Mnemonic Passphrase." };
  }
}
