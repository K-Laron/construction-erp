declare global {
  var mlekSecret: Buffer | undefined;
  var mlekLastActivity: number | undefined;
}

const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export function getMlekSecret(updateActivity = true): Buffer {
  const secret = globalThis.mlekSecret;
  if (!secret) throw new Error("DATABASE_LOCKED: Store is locked.");

  const lastActive = globalThis.mlekLastActivity || 0;
  if (lastActive > 0 && Date.now() - lastActive > INACTIVITY_TIMEOUT) {
    secret.fill(0); // Securely zero-out memory
    globalThis.mlekSecret = undefined;
    globalThis.mlekLastActivity = undefined;
    throw new Error("DATABASE_LOCKED: Store locked due to inactivity.");
  }

  if (updateActivity) {
    globalThis.mlekLastActivity = Date.now();
  }
  return secret;
}

export function setMlekSecret(secret: Buffer | null): void {
  globalThis.mlekSecret = secret ?? undefined;
  globalThis.mlekLastActivity = secret ? Date.now() : undefined;
}

export function isMlekUnlocked(): boolean {
  try {
    getMlekSecret(false);
    return true;
  } catch {
    return false;
  }
}

const healthCheckTimers = new Set<ReturnType<typeof setInterval>>();

// ponytail: single-interval health check, no observability framework
export function startMlekHealthCheck(intervalMs = 60000): void {
  const timer = setInterval(() => {
    if (globalThis.mlekSecret && !isMlekUnlocked()) {
      console.warn('[MLEK] Health check: store lock detected (inactivity timeout).');
    }
  }, intervalMs);
  healthCheckTimers.add(timer);
}

export function stopMlekHealthChecks(): void {
  for (const t of healthCheckTimers) clearInterval(t);
  healthCheckTimers.clear();
}
