# Construction Supply POS & ERP

A completely local-first, offline-capable Enterprise Resource Planning (ERP) suite and Point of Sale (POS) system designed specifically for small-to-medium construction supply businesses.

## Features

- **Local-First & Offline Capable:** Runs locally on a SQLite database. No internet required. Perfect for warehouses or remote store locations.
- **Minimal Apple-Style UI:** Built with a clean, high-contrast, "Bento-box" inspired design. Crisp white panels, neutral surfaces, and interactive blue accents ensure maximum daylight readability and ease of use for staff.
- **Double-Entry General Ledger:** An integrated double-entry accounting engine automatically keeps your books balanced with every transaction.
- **Inventory & Supply Chain:** Granular tracking in scaled integer millicounts to prevent decimal drift. Includes Supplier Procurement (PO to Goods Receipt) and low stock alerts.
- **Customer CRM & Credit Ledger:** Track customer credit limits, manage post-dated checks, and generate chronological statements of account.
- **Labor & Payroll Management:** Track hourly timecards, piece-rate fabrication logs, and generate payslips directly.
- **Enterprise-Grade Security:**
  - Role-Based Access Control (Cashier, Manager, Admin).
  - PBKDF2-SHA512 key derivation with AES-256-GCM encryption for sensitive PII.
  - HMAC-SHA256 ledger chaining for tamper detection.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** SQLite (`better-sqlite3`)
- **Styling:** Tailwind CSS v4
- **Icons:** Lucide React

## Getting Started

Install the dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
# Or for production:
npm run build && npm run start
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

## Documentation

- [Product Requirements Document (PRD)](./docs/PRD.md)
- [Implementation Plan](./docs/IMPLEMENTATION_PLAN.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)

## Security & Auditing

The system has undergone multiple comprehensive security, structural, and integration audits:
- **Round 3 Deep Audit Resolved:** 100% of identified High and Medium severity logic and security findings (e.g. overpayment negative balance guards, cashier collection scoping, bip39 2048-word mnemonic standards, server-side discount override constraints, and strict PIN entropy) have been successfully mitigated.
- **Migration Data Integrity:** Schema updates safely preserve constraints without data loss. Includes tracking VAT payable liabilities via `003_add_vat_payable.sql`, supplier ledger HMAC tracking via `004_hmac_hardening.sql`, and robust collections tracking via `005_add_cashier_id_to_customer_ledger.sql`.
- **Crypto-secure Memory:** Cryptographic routines verified: 600,000 iteration PBKDF2 manager override PIN checks, AES-256-GCM memory encryption, and timestamped HMAC signature chaining preventing tampering and replay attacks.
- **Accounting Accuracy:** Real-time dynamic Z-Readings strip inclusive tax for strict BIR-compliant `vatable_sales` extraction. The General Ledger securely logs mathematically verified split debits/credits to `acc-revenue` and `acc-vat-payable` independently, correctly reversed during `processReturn`.

## Testing & Validation
The project boasts thorough continuous integration testing coverage across server actions using Vitest and an in-memory SQLite (`better-sqlite3`) database mapping.
- **Transactions & Ledgers (`transactions.test.ts`, `ledger.test.ts`):** Math tampering, correct split-journal-entry GL, and HMAC timestamp validations. Worker threads gracefully fallback to inline queries to prevent SQLite memory database deadlocks.
- **Authentication & Core API (`auth.test.ts`, `shifts.test.ts`, `inventory.test.ts`):** Rate limiting algorithms, WAC array recalculations, and discrepancy reporting all operate under isolated suite scopes.
