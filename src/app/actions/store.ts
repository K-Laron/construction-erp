"use server";

import { initializeDatabase, isStoreConfigured, lockStore } from '@/lib/init';
import { isMlekUnlocked } from '@/lib/mlek';
import { requireAuth } from './auth';

// Initialize database on first server action call
initializeDatabase().catch((err) => {
  // Let it fail silently here; actual errors will throw when getStoreStatus or query is executed
});

export async function getStoreStatus(): Promise<{ isConfigured: boolean; isUnlocked: boolean }> {
  await initializeDatabase();
  return {
    isConfigured: isStoreConfigured(),
    isUnlocked: isMlekUnlocked()
  };
}

export async function lockStoreAction(): Promise<void> {
  await requireAuth(['Manager', 'Admin']);
  lockStore();
}
