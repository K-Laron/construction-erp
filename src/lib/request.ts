import { headers } from 'next/headers';

export async function getClientIP(): Promise<string> {
  try {
    const h = await headers();
    const trustProxy = process.env.TRUST_PROXY === 'true';
    if (trustProxy) {
      const forwarded = h.get('x-forwarded-for');
      if (forwarded) {
        return forwarded.split(',')[0].trim();
      }
      const realIp = h.get('x-real-ip');
      if (realIp) return realIp.trim();
    }
    return '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}
