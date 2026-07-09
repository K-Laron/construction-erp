"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export async function exportEncryptedBackup(): Promise<{ success: boolean; data?: string; filename?: string; error?: string }> {
  const secret = (global as any).mlekSecret;
  if (!secret) {
    return { success: false, error: "Store is locked." };
  }

  try {
    const tempBackupPath = path.resolve(process.cwd(), 'data/backup_temp.db');
    if (fs.existsSync(tempBackupPath)) fs.unlinkSync(tempBackupPath);

    // Call better-sqlite3 native WAL-safe backup API
    await db.backup(tempBackupPath);

    // Read the backup data
    const rawBuffer = fs.readFileSync(tempBackupPath);
    
    // Encrypt the entire file buffer via AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(rawBuffer),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    // Clean up unencrypted file immediately
    fs.unlinkSync(tempBackupPath);

    // Payload: iv (12 bytes) + tag (16 bytes) + encrypted content
    const finalPayload = Buffer.concat([iv, tag, encrypted]);
    
    return {
      success: true,
      data: finalPayload.toString('base64'),
      filename: `backup_${new Date().toISOString().slice(0, 10)}.enc`
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Get the night backup logs from the system audit log
export async function getBackupLogs(): Promise<any[]> {
  const secret = (global as any).mlekSecret;
  if (!secret) return [];
  
  return db.prepare(`
    SELECT * FROM system_audit_logs 
    WHERE action_type = 'BACKUP_CRON' 
    ORDER BY timestamp DESC 
    LIMIT 10
  `).all();
}
