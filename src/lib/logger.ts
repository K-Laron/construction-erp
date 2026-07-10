import { headers } from 'next/headers';

type LogLevel = 'info' | 'warn' | 'error';
const isProd = process.env.NODE_ENV === 'production';

async function getTraceId(): Promise<string | undefined> {
  try {
    const h = await headers();
    return h.get('x-trace-id') || undefined;
  } catch {
    return undefined;
  }
}

async function log(level: LogLevel, message: string, ...args: unknown[]): Promise<void> {
  const ts = new Date().toISOString();
  const traceId = await getTraceId();

  if (isProd) {
    const payload = {
      timestamp: ts,
      level: level.toUpperCase(),
      message,
      traceId,
      details: args.length > 0 ? args : undefined,
    };
    if (level === 'error') {
      console.error(JSON.stringify(payload));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(payload));
    }
  } else {
    const tracePrefix = traceId ? ` [Trace: ${traceId}]` : '';
    console.log(`[${ts}] [${level.toUpperCase()}]${tracePrefix} ${message}`, ...args);
  }
}

export const logger = {
  info: (msg: string, ...args: unknown[]) => { log('info', msg, ...args); },
  warn: (msg: string, ...args: unknown[]) => { log('warn', msg, ...args); },
  error: (msg: string, ...args: unknown[]) => { log('error', msg, ...args); },
};
