import { getIronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  userId?: string;
  role?: string;
}

import crypto from 'crypto';

let sessionPassword = process.env.SESSION_PASSWORD;
if (!sessionPassword) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_PASSWORD environment variable is required in production.');
  } else {
    sessionPassword = (global as { __sessionPassword?: string }).__sessionPassword;
    if (!sessionPassword) {
      sessionPassword = crypto.randomBytes(32).toString('hex');
      (global as { __sessionPassword?: string }).__sessionPassword = sessionPassword;
    }
  }
}

export const sessionOptions: SessionOptions = {
  password: sessionPassword as string,
  cookieName: 'construction_erp_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session;
}
