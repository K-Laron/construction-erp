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

First, ensure you have set up your local LAN SSL certificates using `mkcert` as defined in the PRD, as the system relies on secure contexts.

Install the dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
# Note: The system runs in HTTPS mode to support secure crypto contexts.
```

Open [https://localhost:3000](https://localhost:3000) with your browser to see the application.

## Documentation

- [Product Requirements Document (PRD)](./docs/PRD.md)
- [Implementation Plan](./docs/IMPLEMENTATION_PLAN.md)
