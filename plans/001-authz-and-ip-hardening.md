# Plan 001: Close unauthenticated actions & spoofable IP rate-limits

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> ```bash
> git diff --stat cb7bb9b..HEAD -- \
>   src/app/actions/auth.ts \
>   src/app/actions/store.ts \
>   src/app/actions/unlock.ts \
>   src/app/actions/backup.ts \
>   src/app/actions/__tests__/rbac_and_concurrency.test.ts \
>   src/app/actions/__tests__/auth.test.ts
> ```
> If any in-scope file changed since `cb7bb9b` in ways that diverge from the
> "Current state" excerpts, re-read the live files and adapt only if the same
> bug still exists. If the bug is already fixed, mark plan DONE and stop.

## Status

- **Priority**: P1
- **Effort**: S (a few hours including tests)
- **Risk**: LOW — additive auth checks; callers already authenticated in UI flows
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `cb7bb9b`, 2026-07-11

## Why this matters

This ERP is designed for multi-terminal LAN use. Next.js Server Actions are
callable by any client that can reach the host. Three holes remain:

1. `getUsers()` returns every username/role with **no session check**.
2. `lockStoreAction()` zeroes the MLEK and locks the store with **no session check** (availability DoS).
3. `authenticateUser`, `unlockStore`, `recoverStore`, and `exportEncryptedBackup` accept optional `providedIp` from the client, which **defeats IP rate-limits**. They also trust `x-forwarded-for` unconditionally, contradicting the product PRD default-deny rule.

Closing these is required before any multi-cashier production deploy on a LAN.

## Current state

### Files and roles

| File | Role |
|------|------|
| `src/app/actions/auth.ts` | `requireAuth`, `getUsers`, `authenticateUser` |
| `src/app/actions/store.ts` | `lockStoreAction`, `getStoreStatus` |
| `src/app/actions/unlock.ts` | `unlockStore`, `recoverStore` (rate-limited by IP) |
| `src/app/actions/backup.ts` | `exportEncryptedBackup` (rate-limited by IP) |
| `src/app/actions/__tests__/rbac_and_concurrency.test.ts` | RBAC test patterns with `vi.mocked(getSession)` |
| `docs/developer/PRD.md` | Requires default-deny on client IP / XFF unless reverse-proxy mode |

### Excerpt — unauthenticated `getUsers` (`auth.ts`)

```typescript
// Get all active users
export async function getUsers(): Promise<{ id: string; username: string; name: string; role: string; is_active: number }[]> {
  return db.prepare("SELECT id, username, name, role, is_active FROM users WHERE is_system = 0 ORDER BY name ASC").all() as { id: string; username: string; name: string; role: string; is_active: number; }[];
}
```

### Excerpt — unauthenticated lock (`store.ts`)

```typescript
export async function lockStoreAction(): Promise<void> {
  lockStore();
}
```

### Excerpt — spoofable IP (`auth.ts` ~60–69)

```typescript
export async function authenticateUser(username: string, pin: string, providedIp?: string): Promise<...> {
  let ipAddress = providedIp;
  if (!ipAddress) {
    try {
      const h = await headers();
      ipAddress = h.get('x-forwarded-for') || '127.0.0.1';
    } catch {
      ipAddress = '127.0.0.1';
    }
  }
  // ...
}
```

Same `providedIp` + `x-forwarded-for` pattern exists in:

- `src/app/actions/unlock.ts` — `unlockStore`, `recoverStore`
- `src/app/actions/backup.ts` — `exportEncryptedBackup`

### Callers that must keep working after auth is added

- `src/components/pos/CheckoutModal.tsx` — calls `getUsers()` **after** login (user is on POS screen)
- `src/components/maintenance/MaintenancePanel.tsx` — calls `getUsers()` for admin user management
- `src/app/page.tsx` / `src/components/ui/SidebarNav.tsx` — call `lockStoreAction()` from logged-in dashboard

No UI currently passes `providedIp` (LoginScreen calls `authenticateUser(username, pin)` only). Safe to remove the parameter.

### Conventions to match

- Auth helper: `requireAuth(allowedRoles?)` in `auth.ts` — throws `UNAUTHORIZED` / `RBAC_DENIED`.
- Mutating actions often return `{ success, error }` after try/catch; read actions often throw.
- For `getUsers`, **throw** via `requireAuth()` (same as `getInventory`, `getCustomers`).
- For `lockStoreAction`, either throw or wrap in try/catch returning void — prefer **require auth then lock**; if unauthenticated, throw so client can handle.
- Tests mock session via `vi.mocked(getSession)` — see `rbac_and_concurrency.test.ts`.
- Global default session mock in `vitest.setup.ts` uses `userId: 'system-daemon'`, role Admin.

### PRD constraint (inline)

From `docs/developer/PRD.md`: by default resolve client IP from the socket only; ignore client-supplied `X-Forwarded-For` unless reverse-proxy mode is explicitly enabled. Implement a simple env-based switch (no new DB table required for this plan):

- `TRUST_PROXY=true` → may use first hop of `x-forwarded-for`
- otherwise → use only a non-spoofable fallback (`127.0.0.1` or `x-real-ip` only if you also require TRUST_PROXY; simplest: always `127.0.0.1` when not trusting proxy)

For a single-host LAN POS without reverse proxy, **rate limiting by a constant IP is weak but better than client-controlled IP**. Document that real multi-IP lockout needs TRUST_PROXY + reverse proxy. Prefer extracting a shared helper rather than four copy-pastes.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| All tests | `npm test` | all pass |
| Focused tests | `npx vitest run src/app/actions/__tests__/rbac_and_concurrency.test.ts src/app/actions/__tests__/auth.test.ts` | all pass |
| Lint | `npm run lint` | exit 0 (or only pre-existing unrelated issues) |
| Grep gate | `rg "providedIp" src/` | no matches in production src (tests may assert absence) |

## Scope

**In scope** (only these files may be modified/created):

- `src/app/actions/auth.ts`
- `src/app/actions/store.ts`
- `src/app/actions/unlock.ts`
- `src/app/actions/backup.ts`
- `src/lib/client_ip.ts` (**create** — shared IP resolution helper)
- `src/app/actions/__tests__/rbac_and_concurrency.test.ts` (or new `authz_hardening.test.ts` if you prefer isolation)
- `src/app/actions/__tests__/auth.test.ts` (only if needed for IP/auth assertions)
- `plans/README.md` (status row only)

**Out of scope**:

- Changing iron-session cookie options
- Implementing full reverse-proxy CIDR registry in `system_config` (PRD full design) — env `TRUST_PROXY` is enough for this plan
- UI redesign of LoginScreen / MaintenancePanel
- Health endpoint auth (`/api/health`) — deferred
- Rate-limit algorithm changes (keep 3 fails / 5 min, 5 fails / 15 min)

## Git workflow

- Branch: `advisor/001-authz-and-ip-hardening` (or work on current branch if operator says so)
- Commit style: `security: require auth on getUsers/lockStore; ignore client-supplied IP`
- Do NOT push unless instructed

## Steps

### Step 1: Add shared client IP helper

Create `src/lib/client_ip.ts`:

```typescript
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
        // First hop only
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
      }
    } catch {
      // headers() unavailable outside request context
    }
  }
  return '127.0.0.1';
}
```

**Verify**:
```bash
test -f src/lib/client_ip.ts && echo OK
npx tsc --noEmit
```
→ exit 0

### Step 2: Fix `authenticateUser` — remove `providedIp`, use helper

In `src/app/actions/auth.ts`:

1. Import `resolveClientIp` from `@/lib/client_ip`.
2. Change signature to:
   ```typescript
   export async function authenticateUser(username: string, pin: string): Promise<...>
   ```
3. Replace the IP block with:
   ```typescript
   const ipAddress = await resolveClientIp();
   ```
4. Do **not** accept a third argument. If TypeScript callers break, fix only in-scope callers (none in UI today).

**Verify**:
```bash
rg "providedIp" src/app/actions/auth.ts || echo "clean"
npx tsc --noEmit
```

### Step 3: Auth-gate `getUsers`

Replace `getUsers` body:

```typescript
export async function getUsers(): Promise<{ id: string; username: string; name: string; role: string; is_active: number }[]> {
  await requireAuth();
  return db.prepare(
    "SELECT id, username, name, role, is_active FROM users WHERE is_system = 0 ORDER BY name ASC"
  ).all() as { id: string; username: string; name: string; role: string; is_active: number }[];
}
```

Any authenticated role may list users (needed for manager-override dropdown on POS). Do **not** restrict to Manager unless you also change CheckoutModal to stop needing the list for cashiers — cashiers need manager usernames for override. Keep `requireAuth()` with no role filter.

**Verify**:
```bash
npx tsc --noEmit
```

### Step 4: Auth-gate `lockStoreAction`

In `src/app/actions/store.ts`:

```typescript
import { requireAuth } from './auth'; // or '@/app/actions/auth'

export async function lockStoreAction(): Promise<void> {
  await requireAuth(['Manager', 'Admin']);
  lockStore();
}
```

**Role choice (mandatory for this plan):** only Manager/Admin may lock the store (matches operational reality — cashiers should not wipe MLEK). If the UI currently shows Lock to cashiers, either:

- hide Lock for Cashier in `SidebarNav` (allowed small UI edit: `src/components/ui/SidebarNav.tsx` and `DashboardLayout` only if needed), **or**
- allow any authenticated user to lock.

**Decision locked by this plan:** **Manager/Admin only** for lock. If Cashier UI still shows Lock, update SidebarNav so Cashier cannot call it (prevent confusing errors). Add `src/components/ui/SidebarNav.tsx` to in-scope if you change visibility.

**Verify**:
```bash
npx tsc --noEmit
```

### Step 5: Fix unlock + recover + backup IP paths

**`unlock.ts`**:

- Remove `providedIp?: string` from `unlockStore` and `recoverStore`.
- `const ipAddress = await resolveClientIp();`

**`backup.ts`**:

- Remove `providedIp?: string` from `exportEncryptedBackup`.
- `const ipAddress = await resolveClientIp();`
- Keep `requireAuth(['Manager', 'Admin'])` as already present.

**Verify**:
```bash
rg "providedIp" src/ || echo "no providedIp left"
npx tsc --noEmit
```
→ no matches under `src/` (except comments if any — prefer zero)

### Step 6: Tests

Add tests modeled after `rbac_and_concurrency.test.ts`.

**File:** prefer append to `src/app/actions/__tests__/rbac_and_concurrency.test.ts` OR create `src/app/actions/__tests__/authz_hardening.test.ts`.

Required cases:

1. **`getUsers` without session throws / fails**  
   - `vi.mocked(getSession).mockResolvedValueOnce({ save: vi.fn() } as any)` (no userId)  
   - `await expect(getUsers()).rejects.toThrow(/UNAUTHORIZED/)`

2. **`getUsers` with cashier session succeeds**  
   - mock cashier userId  
   - expect array (may be empty or include seeded users)

3. **`lockStoreAction` without session throws**  
   - same unauth mock  
   - `await expect(lockStoreAction()).rejects.toThrow(/UNAUTHORIZED/)`

4. **`lockStoreAction` as Cashier throws RBAC_DENIED**  
   - mock cashier  
   - expect `/RBAC_DENIED/`

5. **`lockStoreAction` as Manager succeeds**  
   - mock manager  
   - after call, `isMlekUnlocked()` is false (import from `@/lib/mlek`)  
   - **Important:** restore MLEK after test with `setMlekSecret(crypto.randomBytes(32))` so later tests don’t fail.

6. **`authenticateUser` ignores a third IP argument** (optional TS compile check)  
   - Call with two args only; ensure lockout still uses resolveClientIp path.  
   - Optional runtime: insert failed attempts with ip `evil`, then call authenticateUser — should not count against client-chosen IP. Simpler: unit-test is not required if TypeScript forbids third arg; ensure signature is 2 params.

**Verify**:
```bash
npx vitest run src/app/actions/__tests__/rbac_and_concurrency.test.ts src/app/actions/__tests__/authz_hardening.test.ts src/app/actions/__tests__/auth.test.ts
```
→ all pass

### Step 7: Full suite + typecheck

```bash
npm test
npx tsc --noEmit
npm run lint
```

All must pass (or lint only pre-existing issues outside your files).

### Step 8: Update plan index

Set plan 001 Status to `DONE` in `plans/README.md`.

## Test plan

| Case | Expected |
|------|----------|
| getUsers unauthenticated | throws UNAUTHORIZED |
| getUsers as Cashier | returns user list |
| lockStore as unauth | throws UNAUTHORIZED |
| lockStore as Cashier | throws RBAC_DENIED |
| lockStore as Manager/Admin | locks MLEK; restore secret after |
| providedIp removed | `rg providedIp src` empty |
| authenticateUser still works | existing auth tests pass |

Pattern: `src/app/actions/__tests__/rbac_and_concurrency.test.ts`

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm test` exits 0
- [ ] `rg "providedIp" src/` returns no matches
- [ ] `getUsers` calls `requireAuth` (grep confirms)
- [ ] `lockStoreAction` calls `requireAuth` with Manager/Admin
- [ ] Shared `src/lib/client_ip.ts` exists and is used by auth, unlock, backup
- [ ] No files outside Scope modified (except allowed SidebarNav for Lock visibility)
- [ ] `plans/README.md` row 001 = DONE

## STOP conditions

Stop and report if:

- Drift: excerpts no longer match and the vulnerability is already fixed differently.
- Adding `requireAuth` to `getUsers` breaks component tests in a way that cannot be fixed by mocking session (report; do not weaken auth).
- `lockStore` as Manager-only conflicts with an explicit product requirement that cashiers lock registers — report and ask operator (do not silently allow all roles).
- `headers()` cannot be imported from the new helper in the test environment — fall back to returning `127.0.0.1` inside try/catch (already in snippet); if tests still hang, stop and report.
- You believe you must edit `next.config.ts` or middleware — out of scope; stop.

## Maintenance notes

- Future reverse-proxy deploys must set `TRUST_PROXY=true` and ensure the proxy overwrites `X-Forwarded-For`.
- Reviewers: confirm no remaining server action accepts client IP strings.
- Follow-up: optionally protect `/api/health` and add audit log on store lock.
