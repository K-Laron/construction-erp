export function getMlekSecret(): Buffer {
  const secret = (global as any).mlekSecret;
  if (!secret) throw new Error("DATABASE_LOCKED: Store is locked.");
  return secret;
}

export function checkMlek(): void {
  if (!(global as any).mlekSecret) throw new Error("DATABASE_LOCKED: Store is locked.");
}

export function setMlekSecret(secret: Buffer | null): void {
  (global as any).mlekSecret = secret;
}

export function isMlekUnlocked(): boolean {
  return !!(global as any).mlekSecret;
}
