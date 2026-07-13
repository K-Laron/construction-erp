# Construction Supply POS & ERP

**Next.js 16 (App Router) · SQLite (WAL) · Tailwind CSS v4 · TypeScript · Vitest**

A local-first, offline-capable Point-of-Sale and Enterprise Resource Planning system purpose-built for construction supply retailers. Designed for harsh daylight environments with a high-contrast data-dense dashboard, light/dark mode, enterprise-grade security, and full BIR compliance.

---

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Framework   | Next.js 16 (App Router)             |
| Database    | SQLite via better-sqlite3, WAL mode |
| Styling     | Tailwind CSS v4, CSS custom property theming   |
| Icons       | Lucide React                        |
| Fonts       | Fira Sans (body), Fira Code (heading/mono)
| Testing     | Vitest (17 suites, 110 tests)        |
| Logging     | Structured logger (JSON, level-filtered)  |

## Features

### Core Operations

- **Point of Sale** — Fast checkout with server-side price validation and tax recalculation to prevent client-side tampering and VAT underreporting
- **Inventory Management** — Millicount precision (eliminates decimal drift), supplier procurement, and low-stock alerts
- **Customer CRM** — Encrypted PII (AES-256-GCM), credit limits, and HMAC-chained ledger entries
- **Double-Entry General Ledger** — Balanced journal entries with cryptographic integrity verification
- **Delivery Dispatch** — TOCTOU-safe validation inside database transactions. Calendar view (month/week/agenda) with keyboard-navigable grid, unscheduled panel, and day-detail trip cards.
- **Shift Management** — Z-readings with BIR-compliant vatable sales extraction

### Architecture

- **Local-first & offline-capable** — SQLite database, no internet required, runs on LAN
- **High-contrast daylight readability** — Data-dense dashboard with light/dark mode, optimized for outdoor/warehouse environments
- **A6 portrait print engine** — Receipt generation for thermal and standard printers (1/4 A4 size)
- **Structured error handling** — All server actions return `{ success, data, error }`; `ErrorBoundary` component for UI crash isolation
- **Graceful shutdown** — SIGTERM/SIGINT handler ensures clean DB closure (exit code, not process kill)
- **Production Logging** — Outputs single-line JSON log strings with dynamic trace correlation ID extraction
- **Health endpoint** — `GET /api/health` returns DB and server status for monitoring and load balancer probes

## Security

> [!IMPORTANT]
> 11 rounds of comprehensive security audits completed. Zero known security vulnerabilities. All catch blocks use `unknown` type with `instanceof Error` narrowing. All form labels have `htmlFor`/`id` associations.

### Authentication & Access Control

- **RBAC** with three roles: Cashier, Manager, Admin
- **PBKDF2-SHA512 key derivation** — 100K iterations (DOP), 600K iterations (MMP/PIN)
- **Cryptographically random admin PIN** generated on bootstrap (no hardcoded credentials)
- **Cryptographically secure PRNG** for recovery mnemonic generation (`crypto.getRandomValues` instead of `Math.random`)
- **System daemon** seeded with a random unreachable hash
- **Rate-limited authentication** with IP and account lockouts (transactional) — set `TRUST_PROXY=true` behind a reverse proxy for per-device rate limiting
- **Session cookies** via iron-session with enforced production password
- **MLEK Inactivity Auto-Lock** — Decrypted master ledger key zero-filled and evicted from process memory after 30 minutes of inactivity
- **Zod Validation Boundaries** — All mutating server actions strictly validate input types and constraints prior to execution
- **Backup Verification** — Every backup copy runs `PRAGMA integrity_check` prior to final AES-256-GCM encryption

### Data Protection

- **AES-256-GCM encryption** for all customer PII
- **HMAC-SHA256 ledger chaining** with timestamps for tamper detection
- **Derived backup encryption key** (PBKDF2 from MLEK — not raw key reuse)
- **Server-side price validation** against DB (prevents client price tampering)
- **Server-side tax recalculation** (prevents VAT underreporting)

## Codebase Overview

```
src/
├── app/actions/        # 10 server actions
│   ├── auth            # Authentication & rate limiting
│   ├── backup          # Encrypted backup/restore
│   ├── customers       # CRM operations
│   ├── deliveries      # Dispatch management
│   ├── inventory       # Stock & procurement
│   ├── ledger          # General ledger entries
│   ├── shifts          # Shift & Z-reading management
│   ├── store           # Store configuration
│   ├── transactions    # POS transactions
│   └── unlock          # Bootstrap & PIN management
│
├── lib/                # 9 shared libraries
│   ├── crypto          # AES-256-GCM encryption
│   ├── db              # SQLite connection (WAL mode)
│   ├── format          # Number & currency formatting
│   ├── init            # Database initialization
│   ├── ledger_helpers  # HMAC-SHA256 chaining + ledger utilities
│   ├── logger          # Structured logger
│   ├── mlek            # Master Ledger Encryption Key
│   ├── request         # Client IP extraction (TRUST_PROXY-aware)
│   ├── session         # iron-session management
│
├── components/         # 19 components
│   ├── crm/            # Customer management UI
│   ├── deliveries/     # Delivery dispatch UI
│   ├── inventory/      # Stock management UI
│   ├── maintenance/    # System maintenance UI
│   ├── pos/            # Point-of-sale UI
│   ├── print/          # A6 receipt engine
│   └── ui/             # Shared UI primitives (SkeletonLine, Modal, etc.)
│
├── features/           # Feature-based modules
│   └── reports/        # Reporting dashboards
│
└── migrations/         # 6 SQL + 1 JS migration
    ├── 001_initial_schema
    ├── 002_indexes_and_constraints
    ├── 003_add_vat_payable
    ├── 004_hmac_hardening
    ├── 005_add_cashier_id_to_customer_ledger
    ├── 006_recalculate_ledger_hmacs [JS]
    ├── 007_repair_supplier_ledger_hmacs [JS]
    └── 008_standardize_timestamps_to_iso8601
```

## Testing

**17 test suites · 110 tests passing · tsc --noEmit clean (source)**

All tests run against in-memory SQLite with the full migration suite applied.

### Server Action Tests (12 suites)

| Suite                     | Coverage                                               |
| ------------------------- | ------------------------------------------------------ |
| `auth`                    | Rate limiting, PBKDF2 PIN override, user CRUD, cost price, credit limit |
| `inventory`               | Weighted Average Cost, product/supplier CRUD, supplier ledger |
| `ledger`                  | HMAC integrity, trial balance, GL scan                 |
| `shifts`                  | Z-reading reconciliation                               |
| `transactions`            | Price tampering, tax recalc, credit returns, VAT-exempt, cancellations |
| `unlock`                  | Bootstrap flow, DOP validation                         |
| `deliveries`              | Dispatch, confirm, history                             |
| `production_hardening`    | MLEK inactivity auto-lock, Zod validation boundaries, backup integrity dry-run |
| `production_hardening_v2` | Targeted overrides, passive check timer tests, backup restore validation |
| `rbac_and_concurrency`    | RBAC enforcement (Cashier/Manager/Admin), parallel stock-deduction safety |
| `customers_payments`      | FIFO payment allocation, customer CRUD, HMAC integrity scan |
| `store`                   | Store lifecycle (unlock/lock/status)                   |

### Component Tests (4 suites)

| Suite              | Component under test         |
| ------------------ | ---------------------------- |
| `CheckoutModal`    | Checkout flow UI             |
| `POSRegister`      | POS register interface       |
| `PaymentModal`     | Payment processing UI        |
| `DeliveryCalendar` | Calendar/month/week/agenda views, skeleton→data transition, table↔calendar toggle |

### Library Tests (1 suite)

| Suite     | Coverage                              |
| --------- | ------------------------------------- |
| `format`  | Currency, quantity, date formatting   |

## Getting Started

### Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first launch a cryptographically random admin PIN is generated — follow the on-screen bootstrap instructions.

### Production

```bash
npm run build
npm run start
```

## Documentation

| Document                                                                  | Description              |
| ------------------------------------------------------------------------- | ------------------------ |
| [docs/developer/PRD.md](docs/developer/PRD.md)                            | Product Requirements     |
| [docs/developer/IMPLEMENTATION_PLAN.md](docs/developer/IMPLEMENTATION_PLAN.md) | Implementation Plan |
| [docs/operator/DEPLOYMENT.md](docs/operator/DEPLOYMENT.md)                | Deployment Guide         |
| [docs/developer/AUDIT_FINAL.md](docs/developer/AUDIT_FINAL.md)            | Final Security Audit     |
