import db, { runMigrations } from '@/lib/db';
import { getMlekSecret, setMlekSecret, isMlekUnlocked } from "@/lib/mlek";
import { logger } from '@/lib/logger';

let initialized = false;

export async function initializeDatabase() {
  if (initialized) return;

  try {
    await runMigrations();
    initialized = true;
    logger.info('Database initialized with WAL mode and migrations applied.');
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

export function isStoreConfigured(): boolean {
  try {
    const row = db.prepare("SELECT 1 FROM system_config WHERE key = 'mlek_encrypted_dop'").get();
    return !!row;
  } catch {
    return false;
  }
}

export function isStoreUnlocked(): boolean {
  return isMlekUnlocked();
}

export function lockStore(): void {
  const secret = getMlekSecret();
  if (Buffer.isBuffer(secret)) {
    secret.fill(0);
  }
  setMlekSecret(null);
  logger.info('Store locked. MLEK cleared from process memory.');
}
