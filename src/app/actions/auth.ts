"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { getSession } from '@/lib/session';
import { getMlekSecret, checkMlek, setMlekSecret, isMlekUnlocked } from "@/lib/mlek";


export async function getActiveUserId(): Promise<string> {
  const session = await getSession();
  if (!session.userId) throw new Error("UNAUTHORIZED: Not logged in.");
  return session.userId;
}

export async function checkManagerRole(): Promise<string> {
  const userId = await getActiveUserId();
  const user = db.prepare("SELECT role FROM users WHERE id = ? AND is_active = 1").get(userId) as { role: string } | undefined;
  if (!user || (user.role !== 'Manager' && user.role !== 'Admin')) {
    throw new Error("RBAC_DENIED: This action requires Manager or Admin privileges.");
  }
  return userId;
}

// Authenticate user via PIN
export async function authenticateUser(username: string, pin: string, ipAddress: string = '127.0.0.1'): Promise<{ success: boolean; user?: { id: string; username: string; name: string; role: string; }; error?: string }> {
  const timeframe5Min = Date.now() - 300000;
  const timeframe15Min = Date.now() - 900000;

  const attemptId = crypto.randomUUID();

  const authPreCheck = db.transaction(() => {
    // IP Lockout
    const ipFails = db.prepare(`
      SELECT COUNT(*) as count FROM login_attempts WHERE attempt_type = 'PIN' AND ip_address = ? AND is_successful = 0 AND timestamp > ?
    `).get(ipAddress, timeframe5Min) as { count: number };

    if (ipFails.count >= 3) {
      return { success: false, error: "IP temporarily locked. Try again in 5 minutes." };
    }

    // Account lockout
    const acctFails = db.prepare(`
      SELECT COUNT(*) as count FROM login_attempts WHERE attempt_type = 'PIN' AND username = ? AND is_successful = 0 AND timestamp > ?
    `).get(username, timeframe15Min) as { count: number };

    if (acctFails.count >= 5) {
      return { success: false, error: "Account temporarily locked. Try again in 15 minutes." };
    }

    const user = db.prepare("SELECT * FROM users WHERE username = ? AND is_active = 1 AND is_system = 0").get(username) as { id: string; username: string; name: string; role: string; passcode_hash: string; passcode_salt: string; } | undefined;

    if (!user) {
      db.prepare(`INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful) VALUES (?, 'PIN', ?, ?, ?, 0)`)
        .run(attemptId, username, ipAddress, Date.now());
      return { success: false, error: "Invalid username or PIN." };
    }

    // Pessimistically log a failure to prevent concurrent bypass during slow hashing
    db.prepare(`INSERT INTO login_attempts (id, attempt_type, username, ip_address, timestamp, is_successful) VALUES (?, 'PIN', ?, ?, ?, 0)`)
      .run(attemptId, username, ipAddress, Date.now());

    return { success: true, user };
  });

  const preCheck = authPreCheck();
  if (!preCheck.success || !preCheck.user) {
    return { success: false, error: preCheck.error || "Unknown error" };
  }

  const user = preCheck.user;
  const pinHash = crypto.pbkdf2Sync(pin, user.passcode_salt, 600000, 32, 'sha512').toString('hex');

  if (pinHash !== user.passcode_hash) {
    return { success: false, error: "Invalid username or PIN." };
  }

  // Update the optimistic failure to a success
  db.prepare("UPDATE login_attempts SET is_successful = 1 WHERE id = ?").run(attemptId);

  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  await session.save();

  return {
    success: true,
    user: { id: user.id, username: user.username, name: user.name, role: user.role }
  };
}

// Create a new user (Manager/Admin only)
export async function createUser(
  _ignoredCreatedBy: string,
  username: string,
  name: string,
  role: 'Cashier' | 'Manager' | 'Admin',
  pin: string
): Promise<string> {
  checkMlek();
  const createdBy = await checkManagerRole();

  if (!pin || pin.length < 6) {
    throw new Error("PIN must be at least 6 characters long.");
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pin, salt, 600000, 32, 'sha512').toString('hex');
  const userId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
    VALUES (?, ?, ?, ?, ?, ?, 1, 0)
  `).run(userId, username, name, role, hash, salt);

  db.prepare(`
    INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
    VALUES (?, CURRENT_TIMESTAMP, ?, 'USER_CREATED', ?, NULL, ?)
  `).run(crypto.randomUUID(), createdBy, userId, `User ${username} created as ${role}`);

  return userId;
}

// Get all active users
export async function getUsers(): Promise<{ id: string; username: string; name: string; role: string; is_active: number }[]> {
  return db.prepare("SELECT id, username, name, role, is_active FROM users WHERE is_system = 0 ORDER BY name ASC").all() as { id: string; username: string; name: string; role: string; is_active: number; }[];
}

// Update cost price (Manager/Admin + MLEK required)
export async function updateCostPrice(_ignoredUserId: string, itemId: string, newCostCentavos: number): Promise<void> {
  checkMlek();
  const userId = await checkManagerRole();

  const old = db.prepare("SELECT cost_price FROM inventory WHERE id = ?").get(itemId) as { cost_price: number };
  db.prepare("UPDATE inventory SET cost_price = ? WHERE id = ?").run(newCostCentavos, itemId);

  db.prepare(`
    INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
    VALUES (?, CURRENT_TIMESTAMP, ?, 'COST_PRICE_CHANGE', ?, ?, ?)
  `).run(crypto.randomUUID(), userId, itemId, String(old.cost_price), String(newCostCentavos));
}

// Override credit limit (Manager/Admin + MLEK required)
export async function overrideCreditLimit(_ignoredUserId: string, customerId: string, newLimitCentavos: number): Promise<void> {
  checkMlek();
  const userId = await checkManagerRole();

  const old = db.prepare("SELECT credit_limit FROM customers WHERE id = ?").get(customerId) as { credit_limit: number };
  db.prepare("UPDATE customers SET credit_limit = ? WHERE id = ?").run(newLimitCentavos, customerId);

  db.prepare(`
    INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
    VALUES (?, CURRENT_TIMESTAMP, ?, 'CREDIT_LIMIT_OVERRIDE', ?, ?, ?)
  `).run(crypto.randomUUID(), userId, customerId, String(old.credit_limit), String(newLimitCentavos));
}
