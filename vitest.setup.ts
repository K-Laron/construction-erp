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
import { setMlekSecret } from '@/lib/mlek';
setMlekSecret(crypto.randomBytes(32));

import { beforeAll } from 'vitest';
import { runMigrations } from '@/lib/db';
import { getMlekSecret } from '@/lib/mlek';

beforeAll(async () => {
  // Initialize the in-memory database with migrations
  await runMigrations(getMlekSecret().toString('hex'));
});
