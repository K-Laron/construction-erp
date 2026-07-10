declare global {
  var mlekSecret: Buffer | undefined;
}

export function getMlekSecret(): Buffer {
  const secret = globalThis.mlekSecret;
  if (!secret) throw new Error("DATABASE_LOCKED: Store is locked.");
  return secret;
}

export function checkMlek(): void {
  if (!globalThis.mlekSecret) throw new Error("DATABASE_LOCKED: Store is locked.");
}

export function setMlekSecret(secret: Buffer | null): void {
  globalThis.mlekSecret = secret ?? undefined;
}

export function isMlekUnlocked(): boolean {
  return !!globalThis.mlekSecret;
}
