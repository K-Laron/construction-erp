"use server";

import db, { swapDatabase } from '@/lib/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { getMlekSecret } from "@/lib/mlek";
import { logger } from '@/lib/logger';
import { requireAuth } from './auth';
import { getClientIP } from '@/lib/request';

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 300000; // 5 min
const RATE_LIMIT_CLEANUP_INTERVAL = 600000; // 10 min
const backupIpTracker = new Map<string, { count: number; windowStart: number }>();
let lastCleanup = 0;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Periodic sweep to evict stale entries
  if (now - lastCleanup > RATE_LIMIT_CLEANUP_INTERVAL) {
    for (const [key, entry] of backupIpTracker) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
        backupIpTracker.delete(key);
      }
    }
    lastCleanup = now;
  }

  const entry = backupIpTracker.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    backupIpTracker.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function verifyBackupIntegrity(filePath: string): boolean {
  try {
    const tempDb = new Database(filePath, { readonly: true });
    const result = tempDb.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    tempDb.close();
    return result?.integrity_check === 'ok';
  } catch (err) {
    logger.error('Backup integrity check failed to execute', err);
    return false;
  }
}

export async function exportEncryptedBackup(): Promise<{ success: boolean; data?: string; filename?: string; error?: string }> {
  try {
    await requireAuth(['Manager', 'Admin']);
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  const secret = getMlekSecret(false);
  if (!secret) {
    return { success: false, error: "Store is locked." };
  }

  const ipAddress = await getClientIP();

  if (!checkRateLimit(ipAddress)) {
    return { success: false, error: "Rate limit exceeded. Try again in 5 minutes." };
  }

  const tempBackupPath = path.join(os.tmpdir(), `backup_temp_${crypto.randomUUID()}.db`);
  let fd: number | null = null;

  try {
    if (fs.existsSync(tempBackupPath)) fs.unlinkSync(tempBackupPath);

    db.prepare('VACUUM INTO ?').run(tempBackupPath);

    if (!verifyBackupIntegrity(tempBackupPath)) {
      throw new Error("DATABASE_CORRUPTION_DETECTED: Temp DB failed integrity check.");
    }

    // Chunked AES-256-GCM encrypt: read in 64KB chunks, encrypt, collect
    const backupKey = crypto.pbkdf2Sync(secret, 'backup_derivation_salt', 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', backupKey, iv);

    const CHUNK_SIZE = 65536;
    fd = fs.openSync(tempBackupPath, 'r');
    const encryptedChunks: Buffer[] = [];
    let buffer = Buffer.alloc(CHUNK_SIZE);
    let bytesRead: number | null = null;

    while ((bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, null)) !== 0) {
      if (bytesRead < CHUNK_SIZE) buffer = buffer.subarray(0, bytesRead);
      encryptedChunks.push(cipher.update(buffer));
      buffer = Buffer.alloc(CHUNK_SIZE);
    }

    fs.closeSync(fd);
    fd = null;
    encryptedChunks.push(cipher.final());
    const tag = cipher.getAuthTag();

    const finalPayload = Buffer.concat([iv, tag, ...encryptedChunks]);

    return {
      success: true,
      data: finalPayload.toString('base64'),
      filename: `backup_${new Date().toISOString().slice(0, 10)}_${crypto.randomUUID().slice(0, 8)}.enc`
    };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    try {
      if (fs.existsSync(tempBackupPath)) {
        fs.unlinkSync(tempBackupPath);
      }
    } catch (cleanupErr) {
      logger.error('Failed to clean up unencrypted temporary backup', cleanupErr);
    }
  }
}

export async function getBackupLogs(): Promise<{ id: string; timestamp: string; action_type: string }[]> {
  await requireAuth(['Manager', 'Admin']);
  return db.prepare("SELECT id, timestamp, action_type FROM system_audit_logs WHERE action_type IN ('BACKUP_EXPORT', 'BACKUP_IMPORT') ORDER BY timestamp DESC").all() as { id: string; timestamp: string; action_type: string }[];
}

export async function validateAndRestoreBackup(base64Payload: string): Promise<{ success: boolean; error?: string }> {
  const tempRestorePath = path.join(os.tmpdir(), `restore_temp_${crypto.randomUUID()}.db`);
  try {
    const performedByUserId = await requireAuth(['Manager', 'Admin']);
    const secret = getMlekSecret(false);
    if (!secret) throw new Error("Store is locked.");

    const backupKey = crypto.pbkdf2Sync(secret, 'backup_derivation_salt', 100000, 32, 'sha256');

    // Decrypt base64Payload into tempRestorePath
    const buffer = Buffer.from(base64Payload, 'base64');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', backupKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    fs.writeFileSync(tempRestorePath, decrypted);

    // Verify integrity of the decrypted DB
    const tempDb = new Database(tempRestorePath);
    const integrity = tempDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    tempDb.close();

    if (integrity.integrity_check !== 'ok') {
      throw new Error("RESTORE_FAILED: Backup integrity check failed.");
    }

    // Safely close connection, copy tempRestorePath to replace database, and reopen connection
    await swapDatabase(tempRestorePath, secret.toString("hex"));

    // Audit log
    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, 'BACKUP_IMPORT', ?, ?, ?)
    `).run(crypto.randomUUID(), performedByUserId, 'RESTORE', 'OK', 'OK');

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to import backup.' };
  } finally {
    try {
      if (fs.existsSync(tempRestorePath)) {
        fs.unlinkSync(tempRestorePath);
      }
    } catch {}
  }
}
