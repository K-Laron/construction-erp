import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  try {
    const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    if (!row || row.ok !== 1) {
      return NextResponse.json({ status: 'error', message: 'DB query failed' }, { status: 503 });
    }
    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: 'connected',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'error', message, db: 'disconnected' }, { status: 503 });
  }
}
