import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { isMlekUnlocked, getMlekSecret } from '@/lib/mlek';

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, string | boolean | number> = {};

  // 1. Database connectivity
  try {
    db.prepare('SELECT 1').get();
    checks.database = 'ok';
  } catch (err) {
    checks.database = 'error';
  }

  // 2. MLEK / unlock status
  checks.store_unlocked = isMlekUnlocked();

  // 3. Schema migration count
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM schema_migrations').get() as { count: number };
    checks.migrations = row.count;
  } catch {
    checks.migrations = 'unavailable';
  }

  // 4. Active shift count
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM shifts WHERE status = 'Open'").get() as { count: number };
    checks.active_shifts = row.count;
  } catch {
    checks.active_shifts = 'unavailable';
  }

  const healthy = checks.database === 'ok' && checks.store_unlocked === true;

  return NextResponse.json(
    { status: healthy ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}
