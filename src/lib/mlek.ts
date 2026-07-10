export function getMlekSecret(): Buffer {
  const secret = (global as { __mlekSecret?: Buffer | null }).__mlekSecret;
  if (!secret) throw new Error("DATABASE_LOCKED: Store is locked.");
  return secret;
}

export function checkMlek(): void {
  if (!(global as { __mlekSecret?: Buffer | null }).__mlekSecret) throw new Error("DATABASE_LOCKED: Store is locked.");
}

export function setMlekSecret(secret: Buffer | null): void {
  (global as { __mlekSecret?: Buffer | null }).__mlekSecret = secret;
}

export function isMlekUnlocked(): boolean {
  return !!(global as { __mlekSecret?: Buffer | null }).__mlekSecret;
}
