import { getIronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import crypto from 'crypto';

declare global {
  var __sessionPassword: string | undefined;
}

export interface SessionData {
  userId?: string;
  role?: string;
}

let sessionPassword = process.env.SESSION_PASSWORD;
if (!sessionPassword) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_PASSWORD environment variable is required in production.');
  } else {
    sessionPassword = globalThis.__sessionPassword;
    if (!sessionPassword) {
      sessionPassword = crypto.randomBytes(32).toString('hex');
      globalThis.__sessionPassword = sessionPassword;
    }
  }
}

export const sessionOptions: SessionOptions = {
  password: sessionPassword,
  cookieName: 'construction_erp_session',
  cookieOptions: {
    secure: process.env.SESSION_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.SESSION_SECURE !== 'false'),
    sameSite: 'lax',
  },
  ttl: 28800,
};

export async function getSession() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session;
}
