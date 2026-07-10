import { describe, it, expect, beforeEach } from 'vitest';
import db from '@/lib/db';
import { runMigrations } from '@/lib/db';
import { unlockStore, isStoreUnlocked, bootstrapStore } from '../unlock';
import { setMlekSecret } from '@/lib/mlek';

describe('Unlock API', () => {
  beforeEach(async () => {
    await runMigrations();

    // Clear relevant tables
    db.prepare('DELETE FROM system_config').run();
    db.prepare('DELETE FROM users').run();

    const mmp = ["abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract", "absurd", "abuse", "access", "accident"];
    const dop = 'StrongPass123!';
    const bsResult = await bootstrapStore(dop, mmp);
    if (!bsResult.success) {
      throw new Error(`Bootstrap failed: ${bsResult.error}`);
    }
  });

  it('initially shows store as locked', async () => {
    setMlekSecret(null);
    expect(await isStoreUnlocked()).toBe(false);
  });

  it('rejects invalid DOP key', async () => {
    setMlekSecret(null);
    const result = await unlockStore('WrongPass123!');
    expect(result.success).toBe(false);
    expect(await isStoreUnlocked()).toBe(false);
  });

  it('successfully unlocks with correct DOP key', async () => {
    setMlekSecret(null);
    const result = await unlockStore('StrongPass123!');
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(await isStoreUnlocked()).toBe(true);
  });
});
