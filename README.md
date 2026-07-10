# Construction Supply POS & ERP

**Next.js 16 (App Router) · SQLite (WAL) · Tailwind CSS v4 · TypeScript · Vitest · PWA**

A local-first, offline-capable Point-of-Sale and Enterprise Resource Planning system purpose-built for construction supply retailers. Designed for harsh daylight environments with a minimal Apple-style "Bento-box" UI, enterprise-grade security, and full BIR compliance.

---

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Framework   | Next.js 16 (App Router)             |
| Database    | SQLite via better-sqlite3, WAL mode |
| Styling     | Tailwind CSS v4                     |
| Icons       | Lucide React                        |
| Testing     | Vitest                              |
| Offline     | PWA (manifest.json + sw.js)         |

## Features

### Core Operations

- **Point of Sale** — Fast checkout with server-side price validation and tax recalculation to prevent client-side tampering and VAT underreporting
- **Inventory Management** — Millicount precision (eliminates decimal drift), supplier procurement, and low-stock alerts
- **Customer CRM** — Encrypted PII (AES-256-GCM), credit limits, and HMAC-chained ledger entries
- **Double-Entry General Ledger** — Balanced journal entries with cryptographic integrity verification
- **Delivery Dispatch** — TOCTOU-safe validation inside database transactions
- **Shift Management** — Z-readings with BIR-compliant vatable sales extraction

### Architecture

- **Local-first & offline-capable** — SQLite database, no internet required, installable as a PWA
- **High-contrast daylight readability** — Minimal Bento-box UI optimized for outdoor/warehouse environments
- **A5 landscape print engine** — Receipt generation for thermal and standard printers
- **Structured error handling** — All server actions return `{ success, data, error }`; `ErrorBoundary` component for UI crash isolation

## Security

> [!IMPORTANT]
> 8 rounds of comprehensive security audits completed. All High, Medium, and Low severity findings resolved. Zero known security vulnerabilities.

### Authentication & Access Control

- **RBAC** with three roles: Cashier, Manager, Admin
- **PBKDF2-SHA512 key derivation** — 100K iterations (DOP), 600K iterations (MMP/PIN)
- **Cryptographically random admin PIN** generated on bootstrap (no hardcoded credentials)
- **System daemon** seeded with a random unreachable hash
- **Rate-limited authentication** with IP and account lockouts (transactional)
- **Session cookies** via iron-session with enforced production password

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
│   ├── ledger_crypto   # HMAC-SHA256 chaining
│   ├── ledger_helpers  # Ledger utilities
│   ├── mlek            # Master Ledger Encryption Key
│   ├── session         # iron-session management
│   └── utils           # General utilities
│
├── components/         # 20 components
│   ├── crm/            # Customer management UI
│   ├── deliveries/     # Delivery dispatch UI
│   ├── inventory/      # Stock management UI
│   ├── maintenance/    # System maintenance UI
│   ├── pos/            # Point-of-sale UI
│   ├── print/          # A5 receipt engine
│   ├── reports/        # Reporting dashboards
│   └── ui/             # Shared UI primitives
│
└── db/migrations/      # 5 SQL migrations
    ├── 001_initial_schema
    ├── 002_indexes_and_constraints
    ├── 003_add_vat_payable
    ├── 004_hmac_hardening
    └── 005_add_cashier_id_to_customer_ledger
```

## Testing

**10 test suites · 20 tests · all passing · tsc --noEmit clean**

All tests run against in-memory SQLite with the full migration suite applied. Worker threads gracefully fall back to inline queries for in-memory databases.

### Server Action Tests (7 suites)

| Suite            | Coverage                                               |
| ---------------- | ------------------------------------------------------ |
| `auth`           | Rate limiting, PBKDF2 PIN override                     |
| `inventory`      | Weighted Average Cost recalculation                    |
| `ledger`         | HMAC integrity verification                            |
| `shifts`         | Z-reading reconciliation                               |
| `transactions`   | Price tampering, tax recalc, credit returns, VAT-exempt, cancellations |
| `unlock`         | Bootstrap flow, DOP validation                         |
| `deliveries`     | Dispatch validation                                    |

### Component Tests (3 suites)

| Suite            | Component under test    |
| ---------------- | ----------------------- |
| `CheckoutModal`  | Checkout flow UI        |
| `POSRegister`    | POS register interface  |
| `PaymentModal`   | Payment processing UI   |

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

| Document                                                  | Description              |
| --------------------------------------------------------- | ------------------------ |
| [docs/PRD.md](docs/PRD.md)                               | Product Requirements     |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)| Implementation Plan      |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                  | Deployment Guide         |
| [docs/AUDIT_FINAL.md](docs/AUDIT_FINAL.md)                | Final Security Audit     |
