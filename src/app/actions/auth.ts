"use server";

import db from '@/lib/db';
import crypto from 'crypto';
import { getSession } from '@/lib/session';
import { getMlekSecret } from "@/lib/mlek";
import { z } from 'zod';
import { getClientIP } from '@/lib/request';

const CreateUserSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters long"),
  name: z.string().min(1, "Name is required"),
  role: z.enum(['Cashier', 'Manager', 'Admin']),
  pin: z.string().min(6, "PIN must be at least 6 characters long")
});

const UpdateCostPriceSchema = z.object({
  itemId: z.string().uuid(),
  newCostCentavos: z.number().int().nonnegative()
});

const OverrideCreditLimitSchema = z.object({
  customerId: z.string().uuid(),
  newLimitCentavos: z.number().int().nonnegative()
});

export async function getActiveUserId(): Promise<string> {
  const session = await getSession();
  if (!session.userId) throw new Error("UNAUTHORIZED: Not logged in.");
  return session.userId;
}

export async function requireAuth(allowedRoles?: ('Cashier' | 'Manager' | 'Admin')[]): Promise<string> {
  const userId = await getActiveUserId();
  const user = db.prepare("SELECT role, is_active FROM users WHERE id = ?").get(userId) as { role: string; is_active: number } | undefined;
  if (!user || user.is_active !== 1) {
    throw new Error("UNAUTHORIZED: User account is inactive or not found.");
  }
  if (allowedRoles && !allowedRoles.includes(user.role as any)) {
    throw new Error("RBAC_DENIED: This action requires higher privileges.");
  }
  return userId;
}

export async function checkManagerRole(): Promise<string> {
  return requireAuth(['Manager', 'Admin']);
}

export async function logoutUser(): Promise<{ success: boolean }> {
  try {
    const session = await getSession();
    session.destroy();
    return { success: true };
  } catch (err: unknown) {
    return { success: false };
  }
}

// Authenticate user via PIN
export async function authenticateUser(username: string, pin: string): Promise<{ success: boolean; user?: { id: string; username: string; name: string; role: string; }; error?: string }> {
  const ipAddress = await getClientIP();

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
  username: string,
  name: string,
  role: 'Cashier' | 'Manager' | 'Admin',
  pin: string
): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    const parsed = CreateUserSchema.parse({ username, name, role, pin });
    getMlekSecret();
    const createdBy = await checkManagerRole();

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(parsed.pin, salt, 600000, 32, 'sha512').toString('hex');
    const userId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0)
    `).run(userId, parsed.username, parsed.name, parsed.role, hash, salt);

    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, 'USER_CREATED', ?, NULL, ?)
    `).run(crypto.randomUUID(), createdBy, userId, `User ${parsed.username} created as ${parsed.role}`);

    return { success: true, data: userId };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create user' };
  }
}

// Get all active users (any authenticated role — POS manager-override dropdown needs the list)
export async function getUsers(): Promise<{ id: string; username: string; name: string; role: string; is_active: number }[]> {
  await requireAuth();
  return db.prepare("SELECT id, username, name, role, is_active FROM users WHERE is_system = 0 ORDER BY name ASC").all() as { id: string; username: string; name: string; role: string; is_active: number; }[];
}

// Update cost price (Manager/Admin + MLEK required)
export async function updateCostPrice(itemId: string, newCostCentavos: number): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = UpdateCostPriceSchema.parse({ itemId, newCostCentavos });
    getMlekSecret();
    const userId = await checkManagerRole();

    const old = db.prepare("SELECT cost_price FROM inventory WHERE id = ?").get(parsed.itemId) as { cost_price: number } | undefined;
    if (!old) throw new Error("Product not found");

    db.prepare("UPDATE inventory SET cost_price = ? WHERE id = ?").run(parsed.newCostCentavos, parsed.itemId);

    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, 'COST_PRICE_CHANGE', ?, ?, ?)
    `).run(crypto.randomUUID(), userId, parsed.itemId, String(old.cost_price), String(parsed.newCostCentavos));

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Operation failed.' };
  }
}

// Override credit limit (Manager/Admin + MLEK required)
export async function overrideCreditLimit(customerId: string, newLimitCentavos: number): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = OverrideCreditLimitSchema.parse({ customerId, newLimitCentavos });
    getMlekSecret();
    const userId = await checkManagerRole();

    const old = db.prepare("SELECT credit_limit FROM customers WHERE id = ?").get(parsed.customerId) as { credit_limit: number } | undefined;
    if (!old) throw new Error("Customer not found");

    db.prepare("UPDATE customers SET credit_limit = ? WHERE id = ?").run(parsed.newLimitCentavos, parsed.customerId);

    db.prepare(`
      INSERT INTO system_audit_logs (id, timestamp, user_id, action_type, reference_id, old_value, new_value)
      VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, 'CREDIT_LIMIT_OVERRIDE', ?, ?, ?)
    `).run(crypto.randomUUID(), userId, parsed.customerId, String(old.credit_limit), String(parsed.newLimitCentavos));

    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : 'Operation failed.' };
  }
}
