import { vi } from 'vitest';

// Mock getSession for Server Actions during testing
vi.mock('@/lib/session', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 'system-daemon',
    role: 'Admin',
    save: vi.fn()
  })
}));

// Provide a global MLEK secret for testing using a securely generated random key
import crypto from 'crypto';
(global as any).__mlekSecret = crypto.randomBytes(32);

import { beforeAll } from 'vitest';
import db, { runMigrations } from '@/lib/db';

beforeAll(async () => {
  // Initialize the in-memory database with migrations
  await runMigrations((global as any).__mlekSecret.toString('hex'));
});
