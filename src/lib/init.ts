import db, { runMigrations } from '@/lib/db';

let initialized = false;

export async function initializeDatabase() {
  if (initialized) return;

  try {
    // Run SQL migrations on startup (JS migrations need MLEK, deferred until unlock)
    await runMigrations();
    initialized = true;
    console.log('[DB] Database initialized with WAL mode and migrations applied.');
  } catch (error) {
    console.error('[DB] Failed to initialize database:', error);
    throw error;
  }
}

// Check if system_config has been bootstrapped
export function isStoreConfigured(): boolean {
  try {
    const row = db.prepare("SELECT 1 FROM system_config WHERE key = 'mlek_encrypted_dop'").get();
    return !!row;
  } catch {
    return false;
  }
}

// Check if MLEK is in memory
export function isStoreUnlocked(): boolean {
  return !!(global as any).mlekSecret;
}

// Lock the store (clear MLEK from memory)
export function lockStore(): void {
  const secret = (global as any).mlekSecret;
  if (Buffer.isBuffer(secret)) {
    secret.fill(0);
  }
  (global as any).mlekSecret = null;
  console.log('[DB] Store locked. MLEK cleared from process memory.');
}
