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

Desktop and mobile pull from the server periodically and after reconnecting:

```
GET /api/sync/pull?since={last_sync_timestamp}
  → Returns records changed on the server since last sync
  → Format: { table, row_id, operation: "insert"|"update"|"delete", data }
  → Local cache applies changes (read-only projection, not user-editable)
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

## 3. Package catalog

Packages (9 total) — unchanged from the original plan in shape, with two scope notes:

```
packages/
├── repo-types/
├── repo-format/
├── repo-crypto/          # server-only in Track A — see §16b mobile crypto note
├── repo-db-schema/
├── repo-core-db/
│   └── interface.ts
├── repo-core-logic/      # runs on the server only — desktop/mobile never import this
├── repo-db-web/
├── repo-db-local/        # Track A: read-replica adapter only (no write commands)
└── repo-sync/            # Track B: offline write queue — not built in Track A
```

```
apps/
├── web/
│   ├── src/app/actions/     # Thin "use server" wrappers: auth → core-logic
│   └── src/app/api/         # New: HTTP API routes (§2b) + sync/pull
├── desktop/                 # Tauri v2 + React
│   ├── src/                 # React frontend (imports @repo/http-client, @repo/db-local)
│   └── src-tauri/           # Rust backend — narrowed command set, see §6
└── mobile/                  # Expo React Native
    └── src/                 # Touch-optimized UI
```

`repo-core-logic` is listed as a shared package for historical/future reasons (Track B
would need it to validate offline writes client-side in some designs), but **in Track A
it has exactly one runtime consumer: the server.** Desktop and mobile only ever talk to
it over HTTP.

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

**Fix: a simple async queue in front of the connection**, serializing all transactions:

```typescript
// packages/repo-db-web/src/index.ts
import Database from 'better-sqlite3';

export class WebDbConnection implements DbConnection {
  private db: Database.Database;
  private queue: Promise<unknown> = Promise.resolve();

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
    // Chain onto the queue so only one transaction is ever open on this
    // connection at a time, regardless of how many requests arrive concurrently.
    const run = async () => {
      this.db.exec('BEGIN');
      try {
        const result = await fn(this);
        this.db.exec('COMMIT');
        return result;
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    };
    const result = this.queue.then(run, run);
    // Keep the queue alive even if this transaction fails, so later ones still run.
    this.queue = result.catch(() => undefined);
    return result;
  }

  async close() { this.db.close(); }
}
```

This is the minimum fix — a FIFO queue per connection. It trades some concurrency
(transactions are now fully serialized, not just isolated) for correctness, which is the
right tradeoff for a single-SQLite-file server; `better-sqlite3` was already effectively
serializing writes at the OS/file level, so the throughput cost is small. If this becomes
a bottleneck later, a small worker pool with multiple connections (each independently
queued) is the next step — not needed at current scale.

### Desktop/mobile local cache — read-only, no transaction semantics needed

Since the local cache is read-only in Track A (§4), the interleaving problem doesn't
apply there — there's nothing to serialize. This section of the original plan (Tauri
`db_begin`/`db_commit`/`db_rollback`, `expo-sqlite.withTransactionAsync`) is deferred to
Track B, where it would apply to the offline write queue.

### Rust command surface — Track A (narrowed)

| Command | Purpose |
|---|---|
| `db_get(sql, params)` | Single-row read from local cache |
| `db_all(sql, params)` | Multi-row read from local cache |
| `apply_pull_patch(patch)` | Internal — applies a server pull patch to local cache; not exposed to arbitrary UI calls |
| `run_migrations()` | Apply cache schema migrations (no secret argument needed — see §12, cache holds no encrypted columns) |
| `session_get/set/del` | File-based session (bearer token storage) |
| `file_read/write` | Local file I/O for received/shared files (e.g. a downloaded backup handed off via `showSaveDialog` — see §13); the backup bytes themselves are opaque to the client |

`db_run`, `db_begin`, `db_commit`, `db_rollback` are **removed** from Track A — there is
no write path for the UI to reach through them. They would return in a reviewed, scoped
form only if Track B is built.

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
| `getClientIP` | `headers()` from `next/headers` | Real client IP from the HTTP request (server-side) | Real client IP from the HTTP request (server-side) |

Note the change from the original plan: `getClientIP` no longer hardcodes `'127.0.0.1'`
for desktop/mobile. Since all writes now go over real HTTP to the server (§2b), the
server sees the actual LAN IP of the requesting device and can apply the same IP-based
logic it already uses for web — no special-casing needed. The original plan's rate-limiting
rationale (`decision 5`, OS lock screen as the auth boundary) still applies to the PIN/
lockout logic itself, but the client IP is no longer synthetic.

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

## 14. Component migration — unchanged

Mobile nav (bottom tabs replacing the sidebar) remains the only major UI-structural
change; all 6 view screens stay the same across platforms.

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

- Verify the Next.js server boots and serves the HTTP API (§2b) to an external client on
  the same LAN — i.e., `curl` a login + a read endpoint from another machine on the WiFi
- Tauri scaffold — verify dev/build loop and that it can `fetch()` the server over LAN
- Expo scaffold — verify build loop and the same LAN `fetch()`
- pnpm workspace move — confirm it doesn't break the existing test suite

**Phase 1 — Monorepo scaffold (4-6 days)**

- pnpm workspace + turborepo
- Extract `@repo/types`, `@repo/format`, `@repo/crypto` (server-only, see §16 crypto note)
- Extract `@repo/db-schema` (migrations as typed array — no version-column changes yet,
  those are Track B, see §7)
- Move existing app to `apps/web/`
- Rewire imports (~80 statements)
- Verify: existing test suite passes (`turbo run test`)

**Phase 2 — Core logic extraction (2-3 weeks)**

- Week 1: Define `DbConnection`/`SessionManager` interfaces. Implement `@repo/db-web`
  with the connection-queue fix (§6). Extract `auth.ts` + `unlock.ts`.
- Week 2: Extract 5 files in parallel: `store`, `inventory`, `customers`, `shifts`, `ledger`.
- Week 3: Extract `transactions.ts` (biggest, dedicated review — includes a concurrency
  test against the new queued-transaction adapter), `deliveries.ts`, `backup.ts`.
- Verify: full test suite passes; every extracted file has a thin `"use server"` wrapper
  confirming web still works.

**Phase 2b — HTTP API (1-2 weeks, new)**

- Implement the route set in §2b as thin wrappers around `@repo/core-logic`
- Bearer-token mode in `SessionManager`
- Verify: `curl` login + checkout + a read endpoint end-to-end against a running server

**Phase 3 — Desktop client (2-3 weeks)**

- Create `apps/desktop` (React, no Next.js — connects to server via `@repo/http-client`)
- Rust backend: narrowed command set from §6 (reads + pull-patch apply + session + file
  I/O — no write proxy, no MLEK, see §12)
- Implement `@repo/db-local` desktop adapter as a read-only cache
- Build `apps/desktop` UI (same screens, native window)
- Verify: desktop boots, connects to server, all writes round-trip through the server,
  cached reads work, mutating actions are disabled with a clear message when offline

**Phase 4 — Mobile client (2.5-3.5 weeks)**

- Create `apps/mobile` with Expo
- Implement `@repo/db-local` mobile adapter (read-only, `expo-sqlite`)
- Install `expo-secure-store`, `expo-file-system`, `expo-sharing`
- Build bottom tab navigation, port all 6 view screens
- Verify: same acceptance criteria as desktop

**Phase 5 — CI & Polish (1 week)**

- GitHub Actions for all 3 apps
- Full test pass (core-logic + adapter tests)
- Smoke tests: all 3 platforms running the same business logic against the same server

### Track B (deferred — see §20; not scheduled unless decision 13 changes)

**Phase 6 — Offline write queue** — implement §9 in full: `offline_log`, `flushed_log`,
row-versioning schema migration, `repo-sync`, conflict-resolution UI, scoped Rust write
commands. Only for the operations on the allowlist in §9 — never checkout, payments, or
sequence assignment.

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
| Async transaction interleaving on shared `better-sqlite3` connection | **High** (raised from Medium) | Connection-queue fix in §6; serializes all transactions on the connection |
| Phase 2 extraction causes subtle async bugs in checkout transaction | High | Dedicated concurrency test against the queued adapter; async-migration guardrails per transaction site |
| 110+ existing tests regress | High | Tests run after every file extraction; extract one action at a time. (Confirm current suite size before treating "110+" as fact — verify against the actual repo.) |
| HTTP API missing was an unstated dependency for Phase 3/4 | Medium (addressed) | Phase 2b added explicitly; Track A cannot ship without it |
| Rust IPC exposing arbitrary write SQL from the webview | Resolved in Track A | Read-only cache removes the need for `db_run`; Track B would reintroduce a scoped, reviewed version only |
| `invoice_sequence` client-assigned offline | Resolved | Reclassified as server-serialized, excluded from any offline allowlist — §5b, §9 |
| HTTP connection from desktop/mobile to server fails intermittently | Low | Exponential backoff, offline banner, manual "retry now" for reads; mutating actions simply disabled (Track A has no queue to retry) |
| Rust learning curve | Low-Medium | Narrower command set than original (~200 lines, no write proxy) |
| MLEK on mobile/desktop — PII exposure if device lost | Resolved | No MLEK on either client platform in Track A — the premise (local encrypted data to decrypt) doesn't exist once the cache is read-only and backup is host-only. See §12. |

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

- `turbo test` / existing suite green after the monorepo move
- Web checkout/GL tests still pass through thin `"use server"` wrappers
- Desktop/mobile can log in (bearer token) and read inventory/customers over LAN with no
  local MLEK required for those reads
- A checkout attempted from desktop or mobile with the server unreachable is **blocked in
  the UI**, not queued — confirms no local write path exists
- `curl`-ing the HTTP API routes directly (§2b) succeeds independent of any client app
