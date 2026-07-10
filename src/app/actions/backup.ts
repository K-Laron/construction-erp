"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getMlekSecret } from "@/lib/mlek";
import os from 'os';

export async function exportEncryptedBackup(): Promise<{ success: boolean; data?: string; filename?: string; error?: string }> {
  const secret = getMlekSecret();
  if (!secret) {
    return { success: false, error: "Store is locked." };
  }

  const tempBackupPath = path.join(os.tmpdir(), `backup_temp_${crypto.randomUUID()}.db`);
  
  try {
    if (fs.existsSync(tempBackupPath)) fs.unlinkSync(tempBackupPath);

    // Call SQLite native WAL-safe synchronous backup API
    db.prepare('VACUUM INTO ?').run(tempBackupPath);

    // Read the backup data
    const rawBuffer = fs.readFileSync(tempBackupPath);
    
    // H2: Derive a separate key for backup encryption to avoid reusing MLEK directly for AES-GCM
    const backupKey = crypto.pbkdf2Sync(secret, 'backup_derivation_salt', 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', backupKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(rawBuffer),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    // Payload: iv (12 bytes) + tag (16 bytes) + encrypted content
    const finalPayload = Buffer.concat([iv, tag, encrypted]);
    
    return {
      success: true,
      data: finalPayload.toString('base64'),
      filename: `backup_${new Date().toISOString().slice(0, 10)}.enc`
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    // Clean up unencrypted file immediately, regardless of cipher success/failure
    try {
      if (fs.existsSync(tempBackupPath)) {
        fs.unlinkSync(tempBackupPath);
      }
    } catch (cleanupErr) {
      console.error(`CRITICAL: Failed to clean up unencrypted temporary backup at ${tempBackupPath}`, cleanupErr);
    }
  }
}

// Get the night backup logs from the system audit log
export async function getBackupLogs(): Promise<any[]> {
  const secret = getMlekSecret();
  if (!secret) return [];
  
  return db.prepare(`
    SELECT * FROM system_audit_logs 
    WHERE action_type = 'BACKUP_CRON' 
    ORDER BY timestamp DESC 
    LIMIT 10
  `).all();
}
