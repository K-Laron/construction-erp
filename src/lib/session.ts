import { getIronSession } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  userId?: string;
  role?: string;
}

const sessionOptions = {
  password: process.env.SESSION_PASSWORD || 'complex_password_at_least_32_characters_long_for_iron_session',
  cookieName: 'construction_erp_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
  },
};

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_PASSWORD) {
  throw new Error('SESSION_PASSWORD environment variable is required in production.');
}

export async function getSession() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session;
}
