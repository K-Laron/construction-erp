import { headers } from 'next/headers';

/**
 * Resolve client IP for rate limiting.
 * - Never accepts a client-supplied IP argument.
 * - Only trusts X-Forwarded-For when TRUST_PROXY=true.
 */
export async function resolveClientIp(): Promise<string> {
  if (process.env.TRUST_PROXY === 'true') {
    try {
      const h = await headers();
      const xff = h.get('x-forwarded-for');
      if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
      }
    } catch {
      // headers() unavailable outside request context
    }
  }
  return '127.0.0.1';
}
