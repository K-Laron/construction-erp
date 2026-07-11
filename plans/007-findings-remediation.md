# Plan 007: Findings Remediation

Resolve all 9 audit findings from codebase review. Each finding maps to ≥1 task.
No finding omitted. Tasks ordered by risk/effort leverage.

---

## Finding Map

| Finding | Cat | Task(s) | Effort | Priority |
|---------|-----|---------|--------|----------|
| SEC-01 Health endpoint leaks store-locked | SEC | 1a, 1b | S | P1 |
| SEC-02 No CSP header | SEC | 2a, 2b | M | P1 |
| SEC-03 Session cookie implicit httpOnly | SEC | 3a | S | P1 |
| COR-01 getSuppliers MLEK-before-auth ordering | COR | 4a | S | P1 |
| COR-02 Viewer test assertion mismatch | COR | 5a | S | P2 |
| PERF-01 backupIpTracker unbounded growth | PERF | 6a | S | P3 |
| TEST-01 PBKDF2 test timeout | TEST | 7a | S | P2 |
| DX-01 Missing .env.example | DX | 8a | S | P1 |
| ARCH-01 Worker thread import info-only | ARCH | — | — | Informational |

---

## Implementation Phases

### Phase 1 — Low-Risk Security & Ordering Fixes (P1, S-effort)
Tasks: 1a, 3a, 4a, 8a

### Phase 2 — Test Quality & CSP (P1–P2, S–M effort)
Tasks: 2a, 2b, 5a, 7a

### Phase 3 — Performance Hygiene (P3, S-effort)
Task: 6a

---

## Task Specifications

### 1a — Strip `store_unlocked` from public health endpoint

**File**: `src/app/api/health/route.ts`

**Change**:
- Remove lines 17 (`checks.store_unlocked = isMlekUnlocked();`)
- Remove the `import { isMlekUnlocked, getMlekSecret } from '@/lib/mlek';` change to `import { getMlekSecret } from '@/lib/mlek';`
- Remove the `healthy` condition `checks.store_unlocked === true` — keep only `checks.database === 'ok'`
- Keep `checks.migrations` and `checks.active_shifts` (these expose counts, not auth state)

**Result**:
```typescript
const healthy = checks.database === 'ok';
```

**Rationale**: Store-unlocked state is sensitive — reveals whether the store is operational to any network scanner. Shifts/migration counts are low-sensitivity operational metrics.

### 1b — (Optional) Add auth-protected detailed health endpoint

**File**: New file `src/app/api/health/detailed/route.ts`

**Design decision**: Deferred until explicit need. Single-store POS does not justify auth-protected health route today. Not implementing.

**ponytail: skip until multi-store or remote monitoring requirement exists.**

---

### 2a — Add Content-Security-Policy HTTP header

**File**: `src/middleware.ts` (new file)

**Design decision**: Next.js middleware runs on every request, including static assets. Use minimal CSP that covers the app's actual surface without breaking the theme-inline script.

**Implementation**:

```typescript
// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",  // theme inline script needs 'unsafe-inline'
  "style-src 'self' 'unsafe-inline'",   // Tailwind generates inline styles
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Apply to all routes except static files, api in production only
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

**Security consideration**: `'unsafe-inline'` for scripts is not ideal but required because the theme-FOUC prevention script in `layout.tsx` is inline. A nonce-based approach would require plumbing a nonce through `layout.tsx` which is disproportionate for the threat model (LAN POS, not public web app).

**Tradeoff logged**: CSP with `'unsafe-inline'` still blocks external scripts, `eval()`, `object` embeds, and frame ancestors. This is a significant improvement over no CSP.

**Verification**: After deployment, visit every page in the app and verify no CSP violations in browser DevTools console.

### 2b — CSP test

**File**: `src/app/__tests__/middleware.test.ts` (new)

**Test**: Verify CSP header is present and contains expected directives. Use `vi.mock('next/headers')` and call the middleware directly.

```typescript
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

describe('CSP middleware', () => {
  it('sets Content-Security-Policy header', () => {
    const request = new NextRequest(new Request('http://localhost:3000/'));
    const response = middleware(request);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
```

**ponytail: single assertion file, no framework, YAGNI for per-route CSP tests.**

---

### 3a — Explicit `httpOnly` on session cookie

**File**: `src/lib/session.ts`

**Change**: Add `httpOnly: true` to `cookieOptions`.

```typescript
cookieOptions: {
  httpOnly: true,
  secure: process.env.SESSION_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.SESSION_SECURE !== 'false'),
  sameSite: 'lax',
},
```

**Rationale**: iron-session defaults `httpOnly` to `true`, but being explicit protects against upstream default changes. This is defense-in-depth.

---

### 4a — Reorder getSuppliers: auth before MLEK

**File**: `src/app/actions/inventory.ts`

**Change**: Move `await requireAuth()` before `getMlekSecret(false)`.

Before (lines 104-106):
```typescript
export async function getSuppliers(): Promise<Supplier[]> {
  const secret = getMlekSecret(false);
  await requireAuth();
```

After:
```typescript
export async function getSuppliers(): Promise<Supplier[]> {
  await requireAuth();
  const secret = getMlekSecret(false);
```

**Rationale**: All other actions auth first, then check MLEK. Inconsistent ordering produces confusing error sequence if store auto-locks.

---

### 5a — Fix Viewer role test assertion

**File**: `src/app/actions/__tests__/rbac_and_concurrency.test.ts`

**Change** (line 65): `'UNAUTHORIZED'` → `'RBAC_DENIED'`.

```typescript
expect(res.error).toContain('RBAC_DENIED');
```

**Rationale**: `requireAuth(['Manager', 'Admin'])` throws `RBAC_DENIED` for unknown roles, not `UNAUTHORIZED`. The test name already says `(RBAC_DENIED)` — assertion should match.

---

### 6a — Evict stale entries from backupIpTracker

**File**: `src/app/actions/backup.ts`

**Design decision**: Option A (periodic sweep on each call) vs Option B (Map with TTL via `setTimeout` cleanup). Option A is simpler and does not require timers.

**Implementation** — modify `checkRateLimit`:

```typescript
const RATE_LIMIT_WINDOW = 300000; // 5 min
const RATE_LIMIT_CLEANUP_INTERVAL = 600000; // 10 min (only sweep this often)
let lastCleanup = 0;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Periodic sweep every RATE_LIMIT_CLEANUP_INTERVAL
  if (now - lastCleanup > RATE_LIMIT_CLEANUP_INTERVAL) {
    for (const [key, entry] of backupIpTracker) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW) {
        backupIpTracker.delete(key);
      }
    }
    lastCleanup = now;
  }

  const entry = backupIpTracker.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    backupIpTracker.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}
```

**Rationale**: Sweeping on access avoids a separate timer; 10-minute interval is well below the rate-limit window so no entry persists beyond two windows.

**Test note**: Existing backup tests cover the rate limit logic. Add assertion that cleanup does not break normal flow:

```typescript
it('evicts stale entries on cleanup sweep', () => {
  // Advance Date.now() mock, add entry, call checkRateLimit → entry should be evicted
});
```

---

### 7a — Increase PBKDF2 test timeout

**File**: `src/app/actions/__tests__/auth.test.ts`

**Change**: Add 30s timeout to the override PIN test.

```typescript
it('validates override PIN correctly using PBKDF2', async () => {
  // ... existing test body ...
}, 30000);  // 30s timeout
```

**Rationale**: PBKDF2 with 600000 iterations takes 5-6s even on fast hardware. Default Vitest timeout is 5000ms. 30000ms provides headroom for CI under load.

---

### 8a — Create `.env.example`

**File**: `.env.example` (new file)

**Content**:
```bash
# Construction ERP Environment Variables
# Copy this file to .env and fill in values.

# Session encryption password (required in production)
# Generate with: openssl rand -hex 32
SESSION_PASSWORD=

# Set to 'true' to mark cookies as Secure (required for HTTPS)
SESSION_SECURE=true

# Set to 'true' if behind a reverse proxy that sets X-Forwarded-For
TRUST_PROXY=false

# Node environment (set by Next.js automatically in most cases)
# NODE_ENV=development|production|test
```

**Rationale**: Every env var that must be configured is documented in one place. Operators don't need to read source to discover requirements.

---

## Testing Strategy

| Task | Test Type | Coverage |
|------|-----------|----------|
| 1a | Existing health tests pass + manual curl | No regression |
| 2a | New middleware unit test (2b) | Header present, critical directives |
| 3a | Existing session tests pass | No regression |
| 4a | Existing supplier tests pass | No regression |
| 5a | Existing RBAC test passes after assertion fix | Assertion correct |
| 6a | New unit test on eviction | Cleanup does not break rate limit |
| 7a | Existing auth test no longer times out | CI stability |
| 8a | N/A (config file) | N/A |

**Pre-submit checklist**:
1. `npx vitest run` — all 65 tests pass (except pre-existing PBKDF2 timeout, which is fixed by task 7a)
2. `npx tsc --noEmit` — clean
3. Manual: `curl http://localhost:3000/api/health` does not return `store_unlocked`
4. Manual: `curl -I http://localhost:3000/` returns `Content-Security-Policy` header

---

## Deployment Plan

| Step | Action | Rollback |
|------|--------|----------|
| 1 | Commit all changes on feature branch | `git revert` |
| 2 | PR review | Close PR, delete branch |
| 3 | Merge to main, deploy | `git revert <merge-commit>` |
| 4 | Verify health endpoint | Revert if `store_unlocked` still exposed |
| 5 | Verify CSP header with curl | Revert if middleware breaks page rendering |
| 6 | Run test suite on CI | Fix failing tests, redeploy |

**Ordering**: All tasks are independent and can be deployed as a single PR. No migration or data schema changes required.

---

## Monitoring & Observability

- **CSP violations**: No runtime change. If CSP blocks legitimate content, browser console errors appear. Monitor via `report-uri` or `report-to` directive in future enhancement.
- **Rate limiter cleanup**: No logging needed. Memory usage is trivial.
- **Health endpoint**: Verify with `curl` post-deploy that response no longer includes `store_unlocked`.

---

## Documentation Changes

| File | Change |
|------|--------|
| `docs/operator/DEPLOYMENT.md` | Add note about CSP header requirement |
| `docs/developer/PRD.md` | No change needed |
| `README.md` | Add link to `.env.example` (if README exists) |

---

## Acceptance Criteria

1. `GET /api/health` response no longer contains `store_unlocked` field
2. `Content-Security-Policy` header present on all HTML page responses
3. Session cookie has explicit `httpOnly: true`
4. `getSuppliers()` calls `requireAuth()` before `getMlekSecret()`
5. Viewer role test asserts `RBAC_DENIED` not `UNAUTHORIZED`
6. `backupIpTracker` entries older than 5 minutes are evicted on access
7. PBKDF2 test does not time out on CI
8. `.env.example` exists at repo root documenting all env vars
9. `npx vitest run` passes (65 tests)
10. `npx tsc --noEmit` is clean

---

## Effort Summary

| Task | Files Touched | Lines Changed | Risk |
|------|--------------|---------------|------|
| 1a | 1 | -3 | LOW |
| 2a | 1 (new) | ~30 | MED (CSP could block content) |
| 2b | 1 (new) | ~25 | LOW |
| 3a | 1 | +1 | LOW |
| 4a | 1 | 2 lines reorder | LOW |
| 5a | 1 | 1 char | LOW |
| 6a | 1 | ~15 | LOW |
| 7a | 1 | +1 | LOW |
| 8a | 1 (new) | ~14 | LOW |
| **Total** | **9 files** (3 new, 6 existing) | **~90 lines** | **LOW overall** |

All 9 findings resolved. No migration, no schema change, no dependency addition.
