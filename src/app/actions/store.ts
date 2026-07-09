"use server";

import { initializeDatabase, isStoreConfigured, isStoreUnlocked, lockStore } from '@/lib/init';

// Initialize database on first server action call
initializeDatabase();

export async function getStoreStatus(): Promise<{ isConfigured: boolean; isUnlocked: boolean }> {
  return {
    isConfigured: isStoreConfigured(),
    isUnlocked: isStoreUnlocked()
  };
}

export async function lockStoreAction(): Promise<void> {
  lockStore();
}
