# Monorepo + Desktop + Mobile Migration Plan

Status: **Revised — Track A / Track B split**
Target: Architecture reference for multi-platform extraction

**Revision note:** This revision splits the plan into two tracks after review. Track A
(monorepo extraction + deployable desktop/mobile clients, server-first for all writes) is
the executable near-term plan. Track B (offline write queue, row-versioning conflict
resolution) is deferred design — kept in full because the work is good, but not on the
critical path to shipping. The product questions that would gate Track B are now resolved
in §20 (default: no offline writes for v1); Track B is revisited only if that decision
changes.

**Micro-edit note (post second review):** Pull projection contract (§2c), bearer-token
store (§8), nested-transaction / write-queue scope (§6), LAN TLS ops (§16 Phase 0),
package tree honesty (§3), cache IPC (typed reads preferred), component migration honesty
(§14), and test-count wording (§18) were patched for executability.

---

## 1. Motivation

Turn the existing single-package Next.js ERP into a monorepo serving 3 platforms sharing
one authoritative database:

| Platform | Purpose | Primary users |
|---|---|---|
| Web (`apps/web`) | Existing Next.js app — unchanged UX | Office staff, counter POS |
| Desktop (`apps/desktop`) | Tauri v2 app — native window | Warehouse, back-office |
| Mobile (`apps/mobile`) | React Native (Expo) — touch-first | Delivery drivers, site foremen |

### Network model

All devices are on the same office WiFi. The existing Next.js server (with its
`better-sqlite3` database) is the single source of truth for **all** reads and **all**
writes.

**Host topology (resolved — see §20):** for v1, the host is the existing Next.js app
running on the counter/store PC, started the same way it runs today (`next start`).
Desktop is a **client only** — it does not run its own copy of the server or database.
If a future requirement needs desktop to run standalone without a dedicated store PC,
that's a distinct "host mode" for `apps/desktop` and is out of scope here; nothing in
this plan blocks adding it later, since desktop already talks to the host exclusively
over HTTP.

Desktop and mobile devices also run a local SQLite cache. In Track A this cache is a
**read-only replica**, populated by pulling from the server — it never receives writes
from the UI and is never itself the target of a checkout, payment, or any other mutating
action. See §4 for why this replaces the original "write local first" design.

### Design constraints (Track A — active)

- **Server-first for all writes.** Every mutating action — checkout, payment, inventory
  adjustment, delivery status change, anything — goes directly to the server over HTTP.
  The local cache is a read replica only. No client ever "succeeds locally" before the
  server has confirmed. Details in §4.
- **Single-location model** — all devices on same office WiFi. If a device can't reach
  the server, mutating actions are blocked in the UI with a "reconnect to continue"
  state; only cached reads remain available.
- **Rust is SQL-only** on desktop, and in Track A its surface is narrower than originally
  specified — no arbitrary write SQL from the webview. See §4 and §6.
- **Auth always goes through the server.** Desktop/mobile authenticate via the server
  API, not locally. The local cache stores a session token, not credentials.
- **Money-relevant sequences (`invoice_sequence` and similar) are server-serialized and
  never client-assigned**, in either track. See §5b.

### Design constraints (Track B — deferred)

- **Multi-device offline writes with row versioning (CAS).** If/when offline write
  support ships, conflicting offline writes use row versioning (CAS) + operation-aware
  merge rules — not silent reject or last-writer-wins for financial data. Full design in
  §9. **Not built in Track A.**

---

## 1a. Track A vs Track B — what ships when

| | Track A (this plan, executable now) | Track B (deferred, gated) |
|---|---|---|
| Scope | Monorepo extraction, HTTP API, deployable desktop + mobile clients | Offline write queue, conflict resolution UI |
| Money path | Always online, server-first | Would require offline financial writes — **not recommended**, see §20 |
| Local cache | Read-only replica (catalog, customer list, recent orders) | Read/write with `offline_log` + CAS |
| Rust IPC surface | Narrow: reads + typed cache-apply + session + file I/O (no MLEK — see §12) | Adds `db_run`-style write proxy back in, scoped and reviewed |
| Offline behavior | Read cached data with a banner; mutating actions blocked until reconnected | Queue writes, flush + reconcile on reconnect |
| Ships | Usable multi-platform POS/inventory-read/delivery-status app | Optional follow-on, requires explicit product sign-off (§20) |

Track A alone is a complete, shippable product: office staff, warehouse, and drivers all
get native/mobile clients talking to one authoritative server. Track B only matters if
the business later decides devices must keep working (including for **writes**) during
real network outages, which is a narrower and riskier requirement than "read cached data
while offline."

---

## 2. Architecture (Track A)

### Data flow — all platforms, all writes

```
┌─────────────────────────────────────────────────────────────┐
│                       @repo/core-logic                       │
│         (TypeScript, async, runs ONLY on the server)         │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │  HTTP API (§2b)
              ┌───────────────┼───────────────┐
              │               │               │
       Web browser      Tauri Desktop    Expo Mobile
       (no cache)       @repo/http-client @repo/http-client
                              │               │
                              ▼               ▼
                        Local SQLite    Local SQLite
                        (read replica)  (read replica)
```

Every mutating request — from web, desktop, or mobile — goes straight to the server and
runs through `@repo/core-logic` against `better-sqlite3`, the single authoritative
database. There is no local write path. `core-logic` itself continues to run
**only on the server**; desktop and mobile do not import or execute it.

### Cache refresh (reads only)

Desktop and mobile pull from the server periodically and after reconnecting. The
wire format and projection rules are defined in **§2c** (do not invent ad-hoc full-table
dumps in client code).

```
GET /api/sync/pull?cursor={opaque_server_cursor}
  → Returns changed projection rows since cursor (or full snapshot if cursor omitted / "0")
  → Format: { next_cursor, changes: [{ table, row_id, operation, data }] }
  → Local cache applies via apply_pull_patch only (never from UI SQL)
```

This is the **only** way the local cache is written to. The UI never issues a write
against the local SQLite file.

### Offline behavior (Track A)

When a device can't reach the server:

- Reads continue to work against the cached data, with a visible "showing cached data as
  of {time}" indicator.
- Any mutating UI action (checkout, payment, status change, etc.) is **disabled**, with a
  message directing the user to reconnect. Nothing is queued.

This is a deliberate simplification versus the original plan's offline write queue —
see §20 for the tradeoff and how to revisit it.

---

## 2b. HTTP API (new — required for Track A)

Server Actions (`"use server"`) are a Next.js-internal mechanism and are not callable
from Tauri or Expo. Desktop and mobile need real HTTP endpoints. This section did not
exist in the original plan and is added because Track A is not executable without it —
flagging it as an addition rather than folding it silently into an existing phase.

Minimum route set:

- `POST /api/auth/login` — returns a bearer token (mobile/desktop) or sets a cookie (web)
- `POST /api/pos/checkout`
- `POST /api/pos/payment`
- `POST /api/deliveries/:id/status`
- `GET /api/inventory`, `GET /api/customers`, etc. — read endpoints backing the cache pull
- `GET /api/sync/pull?since=...` — cache refresh feed (§2)

`SessionManager` (§8) gains a `Bearer` token mode alongside the existing cookie mode for
non-browser clients.

Each route is a thin wrapper around the same `@repo/core-logic` functions the `"use
server"` actions call — no business logic is duplicated, only the transport differs.

---

## 2c. Pull projection contract (Track A)

This section exists so Phase 3–4 implementers do not invent an unbounded “sync everything”
endpoint. Pull is a **role-filtered, server-authored projection** of catalog and
operational read models — not a dump of the authoritative ledger.

### Cursor (not device wall-clock)

- Query param: `cursor` — opaque string issued by the server in the previous response’s
  `next_cursor` (or omitted / `"0"` for first full snapshot).
- Server advances the cursor using a **server-monotonic** source only: e.g. a
  `sync_revision INTEGER` (or equivalent) bumped on relevant writes, **not** client
  `Date.now()` and not untrusted device clocks.
- Response always includes `next_cursor` the client must store for the next pull.
- Clock skew between devices is irrelevant for pull ordering because clients never
  contribute timestamps to the cursor.

### Tables / projections in scope for Track A cache

Include only fields needed for offline **reads** and online UI fill while online.
**Do not** push MLEK-encrypted ciphertext for clients to decrypt (Track A clients have
no MLEK — §12). Server decrypts and emits plain projections where policy allows.

| Projection table (cache) | Source | Typical fields | Notes |
|---|---|---|---|
| `inv_items` | `inventory` | id, name, category, unit, stock_quantity, selling_price, wholesale_price, reorder_level, is_active | Omit internal cost if role policy requires (see AuthZ) |
| `cust_list` | `customers` | id, name, price_tier, is_vat_exempt, is_active | **Driver role:** name + delivery-relevant fields only. No credit_limit, current_balance, phone, or address on driver devices. Cashier/office may get extended fields per existing web RBAC. Rationale in §12: no client MLEK, so plaintext PII on a lost driver phone is unacceptable — the pull endpoint is the enforcement point. |
| `open_deliveries` | `transactions` + delivery status | transaction_id, customer name, delivery_status, date, totals summary | Not full GL |
| `delivery_lines` | remaining/dispatch lines as needed | item_id, remaining qty, names | Read model for dispatch UI |
| Soft deletes | any of the above | `operation: "delete"` or `is_active: 0` | Clients must apply deletes; never leave stale rows |

**Out of projection (never in client cache in Track A):** `journal_*`, raw HMAC
signatures, full `customer_ledger` / `supplier_ledger` chains, backup blobs, user
passcode hashes/salts, system_config MLEK material, arbitrary SQL dump of server DB.

### AuthZ on pull

- Require authenticated session (cookie or bearer).
- Filter payload by role the same way read APIs do:
  - **Cashier:** inventory sell prices + stock, customers needed for POS, own shift-relevant delivery queue as product defines.
  - **Manager/Admin:** may include cost_price and broader lists if existing web RBAC allows.
- Never return another tenant’s data (single-store product, but still no “dump all users’ PINs”).
- Cost fields: if web UI hides cost from cashiers today, pull must too.

### First sync vs incremental

1. **First install / empty cache:** `GET /api/sync/pull` with no cursor (or `cursor=0`) →
   full snapshot of allowed projections + `next_cursor`.
2. **Incremental:** pass last `next_cursor` → only changes since that revision.
3. If server cannot serve incremental (cursor too old / schema bump): respond with
   `410` or a dedicated `full_resync: true` payload and force full snapshot.

### Client apply rules

- Only `apply_pull_patch` (or equivalent) may write the local SQLite file.
- UI code paths use typed cache readers (preferred) or a **whitelist of read SQL
  templates** — not free-form SQL from the webview for production (see §6).
- After any successful **mutating** HTTP call, client should either await a pull or
  optimistically update only non-authoritative UI state; authoritative numbers always
  come from the server response body for that action.

---

## 3. Package catalog

**Target end-state packages** (up to 9 names in the long-term graph). **Track A does not
create packages it does not use.**

```
packages/   # Track A creates these:
├── repo-types/
├── repo-format/
├── repo-crypto/          # server-only — see §16b
├── repo-db-schema/
├── repo-core-db/         # DbConnection + SessionManager interfaces
├── repo-core-logic/      # server-only runtime consumer in Track A
├── repo-db-web/          # better-sqlite3 adapter (host)
├── repo-db-local/        # read-replica adapter (desktop + mobile)
└── repo-http-client/     # typed fetch wrappers for desktop/mobile (Track A)

# NOT created in Track A Phase 1:
# └── repo-sync/          # Track B ONLY — offline write queue; do not scaffold until §20 decision 13 flips
```

**Phase 1 may start smaller** to reduce churn, then split:

| Minimal first cut (optional) | Later split into |
|---|---|
| `@repo/types` | (stays) |
| `@repo/core` (crypto + format + core-logic) | `repo-crypto`, `repo-format`, `repo-core-logic` |
| `@repo/db` (schema + web adapter) | `repo-db-schema`, `repo-db-web` |

Either layout is valid; the dependency rule is what matters: **apps/desktop and
apps/mobile never depend on `repo-core-logic` or `repo-db-web` at runtime** — only
`http-client` + `db-local` (+ types/format as needed for UI).

```
apps/
├── web/
│   ├── src/app/actions/     # Thin "use server" wrappers: auth → core-logic
│   └── src/app/api/         # HTTP API routes (§2b) + sync/pull (§2c)
├── desktop/                 # Tauri v2 + React
│   ├── src/                 # React frontend (http-client + db-local)
│   └── src-tauri/           # Rust — narrowed command set, see §6
└── mobile/                  # Expo React Native
    └── src/                 # Touch-optimized UI (same workflows, adapted layout — §14)
```

`repo-core-logic` has **exactly one Track A runtime consumer: the server** (`apps/web`
host). Desktop and mobile only ever talk to it over HTTP. `repo-sync` is not part of
Track A’s tree until Track B is explicitly approved.

---

## 4. Local cache adapter (read-only in Track A)

```typescript
// packages/repo-db-local/src/index.ts
// Track A: read-only projection of server data. No write path.
export class LocalCacheDb {
  private cache: DbConnection; // Tauri IPC or expo-sqlite, READ methods only exposed

  async get<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
    return this.cache.prepare(sql).then(s => s.get(...params));
  }

  async all<T>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    return this.cache.prepare(sql).then(s => s.all(...params));
  }

  // Applied only by the sync-pull mechanism, never called from UI code paths.
  async applyPullPatch(patch: PullPatch): Promise<void> {
    return this.cache.applyPatch(patch);
  }

  // No `run()`, no `transaction()` exposed to callers — this cache is never
  // the target of a checkout, payment, or any other mutating action.
}
```

**What changed from the original design, and why:**

The original plan had desktop/mobile write to the local cache first, then POST to the
server ("write-through in connected mode"), with the offline queue as a fallback. On
review, this is a dual-write bug even when the device is online: a checkout can "succeed"
on the device and then be rejected by the server on POST (stock mismatch, GL validation
failure, HMAC sequencing conflict), leaving the user looking at a receipt that never
happened. Removing the local write path removes this failure mode entirely — the server
response *is* the result, full stop.

This also resolves the security concern with the original Rust IPC surface (§6): once the
cache is read-only, there's no reason to expose `db_run(sql, params)` — arbitrary SQL
execution from the webview — at all. The Rust side only needs to apply pull patches
(typed, server-shaped data) and serve read queries.

---

## 5. Write path (Track A)

All mutating actions from any platform:

```
UI action → HTTP request → server (§2b route) → @repo/core-logic → better-sqlite3 → response
                                                        ↓
                                          (async, after response) cache pull picks up
                                          the change on next refresh for other devices
```

There is no `offline_log` table, no queue, no flush endpoint, and no conflict resolution
UI in Track A. If the HTTP request fails (network error), the UI shows the failure
directly — nothing is silently queued for later.

---

## 5b. Server-serialized sequences — `invoice_sequence` and similar

Tax document numbers (`invoice_sequence`) and any other strictly-ordered, legally
sequential identifier are **never assigned by a client, in either track.** This is
stricter than the general "server-first" rule: even in a hypothetical future offline-write
design (Track B), sequence assignment must remain a synchronous, server-only operation —
there is no safe way to pre-assign or merge sequence numbers generated on two different
offline devices. If Track B is ever built, any action that would assign a sequence number
is excluded from the offline-write allowlist entirely, unconditionally.

(The original plan's operation-type table listed `invoice_sequence` under "append-only,
always accepted" alongside ledger tables. That's wrong for a sequence — append-only
correctly describes ledger *rows*, which don't conflict, but the *sequence number itself*
is a single shared counter that cannot be safely advanced by two offline writers. It gets
its own category below.)

---

## 6. Server database adapter — connection-safe transactions

The original `WebDbConnection.transaction()` wrapped an async callback with manual
`BEGIN`/`COMMIT`/`ROLLBACK` on a shared module-level `better-sqlite3` handle. This has a
real concurrency bug: because the callback is `async`, control yields back to the Node
event loop at every `await` inside it, and another concurrent request can run its own
statements against the *same connection* while the first "transaction" is still logically
open — `better-sqlite3` itself has no isolation across this, since only one `BEGIN` is
active on the connection at a time. This is a correctness risk for money paths
specifically (checkout: stock deduction + GL posting), and it would pass all existing
tests while still being wrong under concurrent traffic. **Risk level raised from Medium to
High** — see §18.

**Fix: AsyncLocalStorage-based depth tracking with SAVEPOINT for nested calls**, serializing top-level transactions while allowing safe nesting:

```typescript
// packages/repo-db-web/src/index.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import Database from 'better-sqlite3';

export class WebDbConnection implements DbConnection {
  private db: Database.Database;
  private queue: Promise<unknown> = Promise.resolve();
  private spCounter = 0;
  private txContext = new AsyncLocalStorage<{ depth: number }>();

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async prepare(sql: string): Promise<DbStatement> {
    const stmt = this.db.prepare(sql);
    return {
      run: async (...params) => {
        const result = stmt.run(...params);
        return { changes: result.changes, lastInsertRowid: BigInt(result.lastInsertRowid) };
      },
      get: async (...params) => stmt.get(...params) as any,
      all: async (...params) => stmt.all(...params) as any[],
    };
  }

  async transaction<T>(fn: (db: DbConnection) => Promise<T>): Promise<T> {
    // Genuinely nested call — we're inside the same async call chain
    // that already holds this connection's top-level transaction.
    // AsyncLocalStorage guarantees this: an unrelated concurrent request
    // cannot see this context, unlike a shared counter that would confuse
    // "my own nested call" with "an unrelated request that happened to
    // arrive while my tx is open."
    const ctx = this.txContext.getStore();
    if (ctx) {
      const sp = `sp_${++this.spCounter}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      try {
        const result = await fn(this);
        this.db.exec(`RELEASE ${sp}`);
        return result;
      } catch (e) {
        this.db.exec(`ROLLBACK TO ${sp}`);
        throw e;
      }
    }

    // Top-level call — enqueue so unrelated concurrent requests serialize
    // instead of interleaving on this connection.
    const run = async () => {
      this.db.exec('BEGIN');
      try {
        const result = await this.txContext.run({ depth: 1 }, () => fn(this));
        this.db.exec('COMMIT');
        return result;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async close() { this.db.close(); }
}
```

This is the minimum correct fix — `AsyncLocalStorage` for call-stack lineage + FIFO queue for top-level serialization + SAVEPOINT for genuine nesting without queue deadlock. It trades some concurrency
(transactions are now fully serialized, not just isolated) for correctness, which is the
right tradeoff for a single-SQLite-file server; `better-sqlite3` was already effectively
serializing writes at the OS/file level, so the throughput cost is small. If this becomes
a bottleneck later, a small worker pool with multiple connections (each independently
queued) is the next step — not needed at current scale.

### Write paths outside `transaction()` must also be safe

The queue above only serializes work that goes through `transaction()`. **Any
`prepare().run()` that mutates money/stock outside that API is still racy** under
concurrent requests. Rule for Track A extraction:

- All multi-statement money/stock paths (checkout, payment, receive goods, returns, etc.)
  **must** use a single top-level `db.transaction(...)`.
- Prefer routing **all** mutating `run()` calls through the same queue (e.g. queue
  every `run`/`exec`, not only `transaction`), **or** document and enforce “mutations
  only inside `transaction()`” via code review + lint if practical.

### Nested transactions — why `AsyncLocalStorage` and not a counter

The first version of this fix used a shared `txDepth` counter. That's wrong:
two concurrent top-level requests, A and B, would see the same counter. If B
arrives while A is mid-transaction (i.e. `await`-ing inside `fn(this)`), B
would incorrectly take the `SAVEPOINT` branch — running inside A's still-open
transaction. If A later rolls back, B's already-committed writes roll back with
it, silently. `AsyncLocalStorage` solves this because it is scoped to the async
call chain: B's `transaction()` call runs outside A's ALS context regardless
of timing, so `getStore()` returns `undefined` and B correctly enqueues behind
A on the FIFO queue.

**Concurrency test requirement (§18):** the test must include not just "nested
journal posting within one checkout" (which the broken counter version also
handles correctly, masking the bug) but **two concurrent top-level checkouts
firing simultaneously**, asserting each gets an independent `BEGIN`/`COMMIT`
and that a failure in one never rolls back the other's committed state.

### Desktop/mobile local cache — read-only, no transaction semantics needed

Since the local cache is read-only in Track A (§4), the interleaving problem doesn't
apply there — there's nothing to serialize. This section of the original plan (Tauri
`db_begin`/`db_commit`/`db_rollback`, `expo-sqlite.withTransactionAsync`) is deferred to
Track B, where it would apply to the offline write queue.

### Rust command surface — Track A (narrowed)

| Command | Purpose |
|---|---|
| `cache_query(name, params)` **(preferred)** | Typed/whitelisted read by name (e.g. `list_inventory`, `get_customer`) — no free-form SQL from UI |
| `db_get` / `db_all` **(dev-only or tightly gated)** | If kept, allow only in debug builds or behind a SQL template whitelist; production clients should use `cache_query` |
| `apply_pull_patch(patch)` | Sole path that mutates local cache; applies server pull payload (§2c); not for arbitrary UI SQL |
| `run_migrations()` | Apply cache schema migrations (no MLEK secret — §12) |
| `session_get/set/del` | Store bearer token string only (opaque to Rust) |
| `file_read/write` | Optional opaque file bytes (e.g. download host-produced backup — §13); not required for core POS |

`db_run`, `db_begin`, `db_commit`, `db_rollback` are **removed** from Track A — there is
no write path for the UI to reach through them. They would return in a reviewed, scoped
form only if Track B is built.

**Security note:** Free-form `db_get`/`db_all(sql)` from the webview is better than
`db_run` but still allows data exfil / expensive queries if the webview is compromised.
Prefer typed `cache_query` in production builds.

`mlek_set`/`mlek_get` are **not part of Track A's Rust surface at all** — resolved in
§12: the local cache holds no encrypted data and desktop/mobile perform no local
encrypt/decrypt operations, so there's no MLEK to hold on either platform in this track.

---

## 7. Migration runner per platform

Unchanged in structure from the original plan — SQL and TypeScript-handler migrations,
bundled per platform (filesystem on web, `include_str!()` on desktop, typed array on
mobile). One change: the `version INTEGER` column migration (needed for CAS/row
versioning) is **not part of Track A** — it's only needed if Track B is built, and is
deferred to that point to avoid carrying schema surface area the app doesn't use yet.

---

## 8. Auth abstraction

```typescript
// packages/repo-core-db/src/session.ts
export interface SessionManager {
  getActiveUserId(): Promise<string | null>;
  createSession(userId: string): Promise<{ cookie?: string; bearerToken?: string }>;
  destroySession(): Promise<void>;
  getClientIP(): Promise<string>;
}
```

| Method | Web (server) | Desktop | Mobile |
|---|---|---|---|
| `getActiveUserId` | `iron-session` cookie | Bearer token, validated server-side per request | Bearer token, validated server-side per request |
| `createSession` | `iron-session` save, returns cookie | Returns bearer token, stored via Tauri `session_set` | Returns bearer token, stored via `expo-secure-store` |
| `destroySession` | `iron-session` destroy | `session_del` + server-side token revocation | `expo-secure-store` delete + server-side token revocation |
| `getClientIP` | `headers()` / trusted proxy rules as host already defines | Real client IP from the HTTP request (server-side) | Real client IP from the HTTP request (server-side) |

Note the change from the original plan: `getClientIP` no longer hardcodes `'127.0.0.1'`
for desktop/mobile. Since all writes now go over real HTTP to the server (§2b), the
server sees the actual LAN IP of the requesting device and can apply the same IP-based
logic it already uses for web — no special-casing needed. The original plan's rate-limiting
rationale (`decision 5`, OS lock screen as the auth boundary) still applies to the PIN/
lockout logic itself, but the client IP is no longer synthetic.

### Bearer token persistence (Phase 2b — required design)

Client-side “token in a file / secure store” is **not** enough by itself. The **server**
must be able to validate and revoke tokens.

**Track A default: opaque bearer tokens + server table** (simpler revocation than pure JWT):

```sql
-- Migration on the host DB (Track A / Phase 2b)
CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY,           -- public token id (optional prefix of secret)
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL UNIQUE,       -- SHA-256 (or similar) of the secret; never store raw token
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,              -- e.g. 8–24h sliding or fixed; match product shift length if desired
  revoked_at    TEXT,                       -- non-null => reject
  last_used_at  TEXT,
  user_agent    TEXT,                       -- optional device label
  ip_created    TEXT                        -- optional
);
```

**Login flow (`POST /api/auth/login`):**

1. Existing PIN verification + rate limits (server-side).
2. Generate cryptographically random secret token `tok_…`.
3. Store `token_hash = hash(secret)` + `user_id` + `expires_at`; return **raw secret once**
   in JSON `{ token, expires_at, user }`.
4. Desktop: Tauri `session_set`; mobile: `expo-secure-store`.

**Authenticated request:** `Authorization: Bearer <secret>` → server hashes, looks up
row, rejects if missing / expired / `revoked_at` set; loads user role for RBAC.

**Logout:** client deletes local secret; server sets `revoked_at` (best-effort if online).

**JWT alternative (optional):** short-lived signed access JWT + refresh token table.
Only choose this if you already want stateless access tokens; still need a revocation
story for logout. Opaque tokens above are the default for this plan.

Do **not** implement “unsigned token = userId” or client-minted sessions.

### Rate limiting threat model — unchanged

Desktop and mobile apps run on single-user devices with OS-level screen lock. The 600K
PBKDF2 PIN verification and per-account DB lockout protect against remote/network brute
force; physical access protection is the device's own lock screen. If deployed on a
shared device without OS-level screen lock, deploy on web (server-side auth) instead.

---

## 9. Track B — offline write queue (deferred design)

**This section is unchanged from the reviewed design and is preserved because the work
is sound — it is gated behind the product decision in §20, not built in Track A.**

If offline write support is approved later, the design is: row versioning (CAS) +
operation-aware merge rules, `offline_log` write queue, idempotent flush via
`flushed_log`, and a conflict-resolution UI. Summary of the mechanism:

- Every mutable row carries a `version INTEGER NOT NULL DEFAULT 1`. An offline write
  records the `base_version` of each row it touches; on flush, the server applies the
  write if `base_version` matches current, or resolves per operation type otherwise.
- **Operation-type merge rules:**

  | Operation type | Tables | Rule |
  |---|---|---|
  | Append-only | `account_ledger`, `customer_ledger`, `supplier_ledger`, `transactions` | Always accepted; new rows don't conflict; version bumps per batch |
  | Server-serialized | `invoice_sequence` and similar | **Never offline-writable, in any track.** Excluded from the allowlist entirely — see §5b |
  | State-machine | `deliveries` (pending→dispatched→delivered→confirmed) | Only valid transitions accepted; illegal concurrent transitions rejected with explanation |
  | Delta | `inventory` (qty ±N), `cash_register` (balance ±N) | Applied as commutative operations, not overwrites; server rejects individual deltas that would drive a value below zero ("Insufficient stock"), without rolling back sibling deltas in the same flush |
  | Overwrite (LWW) | `customers`, `suppliers`, `accounts` | Last-writer-wins; server stores both values temporarily, surfaces a "theirs vs. yours" diff |
  | HMAC-chained | any row with an `hmac` column | Append-only semantics only — never edited in place; an in-place edit becomes a new ledger entry, not a row update |

- **Flush idempotency:** `offline_log.id` (client-generated UUID) is used as a
  server-side idempotency key via a `flushed_log` table, so a lost-ack retry returns the
  stored result instead of double-applying a delta. `flushed_log` rows are kept
  indefinitely (append-only, ~200 bytes/row, negligible at expected volume) — a
  time-based tombstone was considered and rejected, since it would reintroduce the
  double-apply gap for delta operations after the expiry window.
- **Only a narrow allowlist of operations should ever be offline-writable** even if Track
  B ships: delivery status transitions, notes/non-financial fields, and similar
  operational (not financial) actions. Checkout, payments, receiving goods, and any
  sequence-number assignment remain server-online-only regardless of track — see §20.

If Track B is greenlit, the Rust command surface regains a scoped, reviewed write path
(not the original unrestricted `db_run`), and `repo-sync` is implemented as originally
specified.

---

## 10. Extraction dependency order

Unchanged from the original plan — this describes `@repo/core-logic` internal extraction
order and applies identically regardless of track:

- **Week 1:** `@repo/core-logic` foundation — crypto, format (zero deps)
- **Week 2:** `unlock.ts` (creates users, derives MLEK), then `auth.ts`
- **Week 3 (parallel):** `store.ts`, `inventory.ts`, `customers.ts`, `shifts.ts`, `ledger.ts`
- **Week 4:** `transactions.ts` (biggest, dedicated review), `deliveries.ts`
- **Week 5:** `backup.ts`

---

## 11. The `"use server"` wrapper pattern — unchanged

Web keeps its existing Server Action wrappers unchanged; desktop/mobile use the new HTTP
API (§2b), which calls the same underlying `@repo/core-logic` functions. No UI changes
for the web app, no logic duplication between the two transports.

---

## 12. MLEK lifecycle (resolved)

**Resolved — no MLEK on mobile, and none needed on desktop either in Track A.**

The original open question was narrower than it needed to be: it asked whether mobile
*specifically* should hold the MLEK. Once Track A resolved the local cache to a read-only
projection (§4) and the host topology to "desktop is a client, not a host" (§1), the
premise for needing MLEK on *either* client platform goes away — not just mobile:

- The local cache holds plaintext projections delivered by the server over an
  authenticated HTTP connection (§2), not encrypted columns the client would need to
  decrypt itself. There's nothing on the device for a client-side key to unlock.
- There's no local ledger and no local HMAC computation on desktop or mobile (§9) — that
  logic runs only on the server.
- Backup/restore is a host-only operation in Track A (§13) — desktop/mobile don't
  encrypt or decrypt backup bytes locally, so they don't need the key that would let
  them do so.

**Practical effect:** MLEK lives only on the server (host), using the original
`globalThis`-in-Node design. `mlek_set`/`mlek_get` are dropped from the Track A Rust
surface (§6) — not deferred, just unnecessary for what desktop and mobile actually do in
this track. If Track B or a future feature requires a client to hold decrypted PII or
compute HMACs locally, MLEK-on-device is reopened at that point as the deliberate
compliance tradeoff the original review described, not defaulted back in silently.

---

## 13. Backup/restore platform interface (revised — host-only in Track A)

Since the host is the counter/store PC running `apps/web` (§1) and MLEK lives only there
(§12), backup **creation and restore happen on the host**, not on desktop or mobile.
Desktop/mobile don't implement `BackupFileSystem`'s encrypt/decrypt logic at all in
Track A — if a client-side "download a backup" convenience feature is wanted, it's a
simple file transfer (the host produces the encrypted file over the HTTP API and the
client just saves/shares the opaque bytes via its native save dialog / share sheet),
never a local encrypt or decrypt.

`BackupFileSystem` as originally specified — `readFile`/`writeFile`/`showSaveDialog`/
`showOpenDialog`/`replaceDatabase`, with Tauri file IPC and native dialogs on desktop,
`expo-file-system`/`expo-sharing` on mobile — still describes the *host's* (web/server)
implementation. It's not something desktop or mobile need to implement locally in this
track. Backup encryption (AES-256-GCM, MLEK-derived key) remains server-only TypeScript
in `@repo/crypto` — see the mobile crypto note in §16.

---

## 14. Component migration — workflows first, not pixel parity

**Track A goal:** same **workflows** (POS checkout, inventory browse, customers,
deliveries, reports read, maintenance as role allows) on each client — **not** a
guarantee of pixel-identical ports of every web component.

| Surface | Layout | UI strategy (Track A) |
|---|---|---|
| Web | Existing sidebar + header | Unchanged; keeps Server Actions + optional HTTP |
| Desktop (Tauri) | Sidebar/header acceptable (large screen) | Prefer reusing React components via shared package **or** copy-adapt from web; desktop is not Next.js |
| Mobile (Expo) | **Bottom tabs + top bar** (replaces sidebar) | **Reimplement screens** with touch targets ≥44px, keyboard-avoiding checkout; shared `@repo/types` + `http-client` only at first |

**Explicit non-goals for Track A Phase 4:**

- Full design-system extraction of every web component into a shared UI package (nice later)
- Wrapping the entire Next app in a WebView as the long-term mobile architecture
- Pixel parity with web density on a 5–6" phone

**Honest effort implication:** Phase 4 estimates assume **functional** mobile workflows
against the HTTP API, possibly with simplified tables/lists, not a line-by-line port of
all web modals on day one. Expand fidelity after the API is stable.

Optional later: `@repo/ui` for buttons/inputs shared by desktop + mobile.

---

## 15. Build configuration — unchanged

`pnpm-workspace.yaml` / `turbo.json` as originally specified.

---

## 16. Phases

### Track A

**Phase 0 — Validate (1-2 days)**

The original "static export smoke test" is removed — `apps/desktop` was already
specified as plain React (no Next.js), so static-exporting the Next app was never
actually on Track A's critical path; it tested the wrong thing. Replaced with:

- Verify the Next.js server boots and serves over the LAN — initially even a simple
  health/read path; full §2b routes land in Phase 2b
- Tauri scaffold — verify dev/build loop and that it can `fetch()` the host on LAN
- Expo scaffold — verify build loop and the same LAN `fetch()`
- pnpm workspace move smoke (or dry-run) — confirm tooling direction
- **LAN TLS / trust (ops — do not skip):** real shops hit certificate trust issues.
  Document one supported path before calling Phase 0 done:
  - **Preferred:** HTTPS with a LAN CA (e.g. mkcert) installed on desktop OS **and**
    Android user trust store / network security config for Expo, **or**
  - **Dev/LAN fallback:** HTTP + `SESSION_SECURE=false` (or equivalent) with explicit
    “trusted WiFi only” warning in operator docs. **This transmits bearer tokens in
    cleartext — see §18 risk register.** Not a supported production deployment.
  Phase 0 exit: at least one external device successfully authenticates or hits a
  protected route under the chosen trust mode.

**Phase 1 — Monorepo scaffold (4-6 days)**

- pnpm workspace + turborepo
- Create **Track A packages only** (§3) — do **not** scaffold `repo-sync`
- Extract `@repo/types`, `@repo/format`, `@repo/crypto` (server-only, see §16b)
  — or the minimal first-cut packages in §3
- Extract `@repo/db-schema` (migrations as typed array — no CAS `version` columns yet;
  those are Track B, see §7)
- Move existing app to `apps/web/`
- Rewire imports (~80 statements)
- Verify: **current** vitest/turbo suite passes (record suite size in CI; do not assume
  a fixed “110+” count)

**Phase 2 — Core logic extraction (2-3 weeks)**

- Week 1: Define `DbConnection`/`SessionManager` interfaces. Implement `@repo/db-web`
  with the connection-queue fix, nested SAVEPOINT rules, and write-path rules (§6).
  Extract `auth.ts` + `unlock.ts`.
- Week 2: Extract 5 files in parallel: `store`, `inventory`, `customers`, `shifts`, `ledger`.
- Week 3: Extract `transactions.ts` (biggest — concurrency test with nested journal
  posting against queued adapter), `deliveries.ts`, `backup.ts`.
- Verify: full existing suite + new adapter tests pass; thin `"use server"` wrappers
  keep web UX working.

**Phase 2b — HTTP API (1-2 weeks, new)**

- Implement the route set in §2b as thin wrappers around `@repo/core-logic`
- Bearer-token mode: `api_tokens` table + hash storage (§8)
- Implement `GET /api/sync/pull` per §2c (cursor, projections, AuthZ)
- Verify: `curl` login + checkout + pull (empty cursor + incremental) end-to-end

**Phase 3 — Desktop client (2-3 weeks)**

- Create `apps/desktop` (React, no Next.js — `@repo/http-client`)
- Rust backend: narrowed command set from §6 (typed cache reads preferred, pull-patch,
  session, optional file I/O — no write proxy, no MLEK)
- Implement `@repo/db-local` as read-only cache applying §2c patches only
- Build desktop UI for the same **workflows** as web (§14), native window
- Verify: boots, server-first writes, cached reads, mutates disabled when offline

**Phase 4 — Mobile client (2.5-3.5 weeks)**

- Create `apps/mobile` with Expo
- Implement `@repo/db-local` mobile adapter (read-only, `expo-sqlite`)
- Install `expo-secure-store` (bearer token). `expo-file-system` / `expo-sharing` are
  **optional** (opaque backup download convenience only — not required for POS)
- Bottom tab navigation; implement mobile layouts for core workflows (§14) — not
  pixel-parity ports of every web modal
- Verify: same acceptance criteria as desktop (login, read, server-side checkout when
  online, blocked mutates offline)

**Phase 5 — CI & Polish (1 week)**

- GitHub Actions for apps that exist (web required; desktop/mobile as they land)
- Full test pass (core-logic + adapter + API tests)
- Smoke: all shipped clients against one host; document LAN TLS mode

### Track B (deferred — see §20; not scheduled unless decision 13 changes)

**Phase 6 — Offline write queue** — implement §9 in full: `offline_log`, `flushed_log`,
row-versioning schema migration, **create `repo-sync` for the first time**, conflict-
resolution UI, scoped Rust write commands. Only allowlisted ops in §9 — never checkout,
payments, or sequence assignment.

---

## 17. Effort estimate

### Track A

| Phase | Duration | Risk | Parallelizable |
|---|---|---|---|
| 0 — Validate | 1-2 days | Low | No |
| 1 — Monorepo scaffold | 4-6 days | Low | No |
| 2 — Core logic extraction | 10-15 days | **High** (concurrency fix, see §6) | Week 2: 5 files parallel |
| 2b — HTTP API | 5-10 days | Medium | Starts after Phase 2 |
| 3 — Desktop client | 10-15 days | Medium | Starts after Phase 2b |
| 4 — Mobile client | 12-18 days | Medium | Starts after Phase 2b |
| 5 — CI & Polish | 3-5 days | Low | No |

**Single developer:** ~11-15 weeks
**Phase 3 + 4 in parallel (after 2b):** ~9-12 weeks

This is longer than the original plan's 9-13 weeks despite dropping the offline write
queue, because the original estimate didn't include an HTTP API phase (Server Actions
were silently assumed reachable from Tauri/Expo, which they aren't) and because the
connection-queue fix adds review time to Phase 2. It's still meaningfully smaller than
Track A + Track B together would be.

### Track B (if approved)

Full offline write queue + CAS + conflict UI + delta inventory, per the original
plan's estimate and the prior review's re-estimate: **+2-4 months**, driven mostly by the
first-time cost of debugging partial flushes, clock skew, and conflict UI edge cases
across two platforms. Not scheduled unless the "no offline writes for v1" default in §20
(decision 13) is revisited.

---

## 18. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Async transaction interleaving on shared `better-sqlite3` connection | **High** (raised from Medium) | Connection-queue fix in §6; serialize txs; queue or ban mutating `run` outside `transaction()` |
| Nested `BEGIN` from journal helpers inside checkout | **High** | `AsyncLocalStorage` scoping in §6 prevents silent cross-request nesting. Concurrency test must include **both** (a) nested journal posting within one checkout, **and** (b) two concurrent top-level checkouts asserting independent BEGIN/COMMIT — the former passes even with the broken shared-counter version and masks the bug. |
| Phase 2 extraction causes subtle async bugs in checkout transaction | High | Dedicated concurrency test against the queued adapter; extract one action at a time |
| Existing test suite regresses | High | Run full suite after every extraction. **Do not assume “110+”** — use the actual count from `npm test` / `turbo test` at kickoff (historically ~48–70+ depending on branch). Grow suite as adapters land. |
| HTTP API missing was an unstated dependency for Phase 3/4 | Medium (addressed) | Phase 2b added explicitly; Track A cannot ship without it |
| Pull endpoint becomes unbounded data dump | Medium | §2c projection + role filter + server cursor |
| Free-form read SQL from webview | Low–Medium | Prefer typed `cache_query`; whitelist if raw SQL kept |
| Bearer tokens without server revocation | Medium | `api_tokens` table + hash + revoke (§8) |
| LAN HTTPS trust failure forces HTTP fallback, exposing bearer tokens in cleartext | Medium | Mitigations (apply one): **A)** prefer mkcert/LAN CA install on all devices (documented path), **B)** if HTTP fallback used, require short-lived tokens (≤4h sliding) and document "trusted LAN only, do not use on shared/public WiFi". The HTTP path is a dev convenience or last resort, not a supported production deployment. |
| Rust IPC exposing arbitrary write SQL from the webview | Resolved in Track A | Read-only cache removes `db_run`; Track B scoped writes only |
| `invoice_sequence` client-assigned offline | Resolved | Server-serialized — §5b, §9 |
| HTTP connection from desktop/mobile fails intermittently | Low | Offline banner; mutates disabled (no write queue in Track A) |
| Rust learning curve | Low-Medium | Narrower command set (~typed cache + patch + session) |
| MLEK on mobile/desktop — PII if device lost | Resolved | No client MLEK in Track A — §12 |

---

## 19. Key decisions log

| # | Decision | Rationale | Date |
|---|---|---|---|
| 1 | Rust is SQL-only — no business logic in Rust | Avoid triple maintenance across TS web + TS mobile + Rust | — |
| 2 | All async — core-logic functions return `Promise` | Mobile SQLite is async; web wraps sync | — |
| 3 | **Connection-queue, not manual BEGIN/COMMIT alone**, in web adapter | Manual BEGIN/COMMIT on a shared connection allows concurrent requests to interleave at `await` points inside a "transaction" — real correctness risk on money paths | Revised |
| 4 | **MLEK lives only on the server (host); not implemented on desktop or mobile** | Once the local cache is read-only and backup/restore is host-only (§12, §13), neither client platform has any local encrypted data to decrypt — the original "Rust MLEK from day 1" rationale (HMAC-chained data needing a key off the webview) doesn't apply, since that data never reaches the client in the first place | Revised |
| 5 | No IP rate limiting distinction — desktop/mobile now send real client IP | Once writes go over real HTTP (§2b), there's no synthetic `127.0.0.1` to special-case; OS lock screen remains the physical-access boundary | Revised |
| 6 | Migrations bundled as TypeScript in `@repo/db-schema` | No filesystem dependency on mobile/desktop | — |
| 7 | **Track A: local cache is read-only; all writes are server-first** | Write-local-then-POST is a dual-write bug even when online (local "success" can be rejected by server validation); removing it also closes the `db_run` security surface | New |
| 8 | **Track A / Track B split** | Full offline write queue with CAS + conflict UI is a distinct, expensive, higher-risk product on top of the monorepo extraction — ship the extraction + online clients first | New |
| 9 | **`invoice_sequence` is server-serialized, never client-assigned, in any track** | No safe way to merge or pre-assign a shared sequential counter written by two offline devices | New |
| 10 | HTTP API (§2b) added as an explicit phase | Server Actions aren't reachable from Tauri/Expo; this was an unstated dependency in the original plan | New |
| 11 | `"use server"` wrappers kept for web | Client imports unchanged — zero UI migration cost | — |
| 12 | Subagent parallel extraction for Level 2 (5 files) | All depend only on `auth` — no cross-dependency | — |
| 13 | **Offline write support: no, for v1** | Track A ships "read cached data, block writes while offline" (§2). Revisit only if the business identifies a concrete case where blocked writes during a real outage are unacceptable — see §20 | New |
| 14 | **Host: the existing counter/store PC runs `apps/web`; desktop is a client, not a host** | Avoids building and maintaining a second "desktop-as-host" mode with no current requirement driving it; nothing in the client architecture blocks adding one later | New |
| 15 | **Tauri (not Electron) confirmed** | The narrowed Track A Rust surface (§6) is ~120 lines with no MLEK and no write proxy — smaller than originally scoped, which further reduces the Rust-hiring-risk concern that would have motivated Electron | New |
| 16 | **Pull uses server cursor + role-filtered projections (§2c)** | Avoid device-clock `since` and full DB dumps; no encrypted-column decrypt on clients | New |
| 17 | **Opaque bearer tokens hashed in `api_tokens` (§8)** | Revocable sessions for desktop/mobile without inventing unsigned client tokens | New |
| 18 | **`repo-sync` not scaffolded in Track A** | Package tree honesty; offline queue is Phase 6 only | New |
| 19 | **Typed cache reads preferred over free-form SQL IPC** | Reduce webview data-exfil surface even for reads | New |
| 20 | **Mobile = same workflows, adapted UI — not pixel parity (§14)** | Keeps Phase 4 estimates honest | New |

---

## 16b. Crypto note (referenced from §13)

`@repo/crypto`'s `AES-256-GCM`/`HMAC`/`PBKDF2` implementation depends on Node's `crypto`
module and does not run as-is in React Native. Since all money/HMAC operations remain
server-only in Track A (§5), mobile does not need to import `@repo/crypto` at all — it
never encrypts or HMACs anything locally. If Track B or a future feature requires
client-side crypto, `@repo/crypto` would need `expo-crypto`-compatible wrappers at that
point; not needed now.

---

## 20. Product decisions — resolved

The four questions the prior review left open are now resolved, using the review's own
suggested defaults (speed-to-multi-platform, lowest compliance exposure). Each is now
also reflected in the relevant section and in the decision log (§19, entries 4, 13-15):

| # | Question | Resolution | Where applied |
|---|---|---|---|
| 1 | Is offline write support required for v1? | **No.** Track A ships read-cached / write-blocked-when-offline. | §2, §19 decision 13 |
| 2 | Must desktop be a self-contained host? | **No.** Host = existing Next app on the counter/store PC; desktop is client-only. | §1, §19 decision 14 |
| 3 | May drivers' phones hold MLEK / decrypt PII offline? | **No — and it turns out neither client needs to hold it at all**, once decisions 1 and 2 above are applied. See §12 for the full reasoning. | §12, §19 decision 4 |
| 4 | Tauri vs. Electron? | **Tauri, confirmed.** The Track A Rust surface is smaller than originally scoped (no MLEK, no write proxy — see §6), which reduces rather than increases the case for switching. | §19 decision 15 |

These are defaults chosen for speed and lowest exposure, not the only reasonable
answers — if the business later has a concrete reason to need offline writes, a
standalone desktop host, or PII on drivers' phones, each is revisited independently and
doesn't require unwinding the others. None of Track A's architecture depends on these
staying "no" forever; §9 (Track B) and the MLEK-on-device design in the original plan
remain available, reviewed, and ready to reintroduce if a decision changes.

---

## Verification checklist (Track A)

- `turbo test` / existing suite green after the monorepo move (record baseline test count
  at kickoff; do not hardcode “110+”)
- Web checkout/GL tests still pass through thin `"use server"` wrappers
- Nested journal-inside-checkout works under the queued `WebDbConnection` (concurrency test)
- `api_tokens`: login returns bearer; revoked/expired tokens fail; logout revokes server-side
- `GET /api/sync/pull`: full snapshot + incremental cursor; role filter omits forbidden fields
- Desktop/mobile can log in (bearer token) and read inventory/customers over LAN with no
  local MLEK required for those reads
- Local cache only mutates via pull patches — no UI path calls write SQL
- A checkout attempted from desktop or mobile with the server unreachable is **blocked in
  the UI**, not queued — confirms no local write path exists
- `curl`-ing the HTTP API routes directly (§2b) succeeds independent of any client app
- Documented LAN TLS or HTTP-dev trust mode works on at least one non-host device (§16 Phase 0)
