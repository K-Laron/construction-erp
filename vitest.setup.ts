import { vi } from 'vitest';

// Mock getSession for Server Actions during testing
vi.mock('@/lib/session', () => ({
  getSession: vi.fn().mockResolvedValue({
    userId: 'system-daemon',
    role: 'Admin',
    save: vi.fn()
  })
}));

// Provide a global MLEK secret for testing
(global as any).mlekSecret = Buffer.from('00000000000000000000000000000000');
