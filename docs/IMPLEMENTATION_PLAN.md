# Detailed Phase-by-Phase ERP Implementation Plan

This document details the step-by-step engineering tasks to build, verify, and launch the local-first, offline-capable Construction Supply ERP and POS suite. It translates all 9 phases and 34 micro-tasks from the architecture design into granular developer tasks with code structures, database schemas, and verification routines.

---

## Goal Description
Build a desktop-first, local-first management suite to operate a complete small-to-medium enterprise (SME) offline. It integrates Point of Sale (POS), CRM, Inventory, Supplier Procurement (PO to Goods Receipt), Worker Labor & Payroll (hourly timecards + piece-rates), Fixed Assets register (depreciation), Petty Cash Expense vouchers, and a double-entry General Ledger (G/L) bookkeeping engine.

---

## User Review Required
> [!IMPORTANT]
> **LAN HTTPS Certificate Generation**: The server relies on browser secure contexts for the Web Crypto API, service workers, and clipboard copy operations. `mkcert` is required on the host system to bind the certificate files dynamically.
>
> **Soft Deletions (No Hard Deletes)**: Hard deletes are disabled on `customers`, `suppliers`, and `inventory` tables. Checkouts and invoice lookups will query `is_active = 1` for active selection, but database relationships will preserve legacy items in historic ledger rows.
>
> **Node worker_threads**: Reporting modules (P&Ls, trial balances) must not share SQLite connection handles. Workers must spin up their own isolated read-only clients.

---

## Detailed Task Breakdown

### Phase 1: Dependencies, HTTPS, & Database Schema Setup

#### Task 1.1: Install Dependencies
- **Description**: Install core production and development packages.
- **Action**: Run installation command:
  ```bash
  npm install better-sqlite3 lucide-react clsx tailwind-merge zod iron-session
  npm install -D @types/better-sqlite3 vitest
  ```
- **Approval Metrics**:
  1. `package.json` contains dependencies and devDependencies with zero conflicts.
  2. `npm run dev` boots the server without compilation or module-resolution crashes.

#### Task 1.2: Local SSL Secure Context Configuration
- **Description**: Setup `mkcert` locally and generate SSL certificates for LAN secure context binding. Add a configuration script to run the local server over HTTPS.
- **Proposed Changes**:
  - Add certificate files to `./certificates/key.pem` and `./certificates/cert.pem` (ignored in `.gitignore`).
  - Modify `package.json` dev script:
    ```json
    "dev": "next dev --experimental-https --experimental-https-key ./certificates/key.pem --experimental-https-cert ./certificates/cert.pem"
    ```
- **Approval Metrics**:
  1. Running the server binds to `https://localhost:3000`.
  2. Navigating to the HTTPS URL in a local browser shows green secure connection symbols.

#### Task 1.3: Database Schema Creation (`migrations/001_initial_schema.sql`)
- **Description**: Create the initial SQL migration script declaring all 24 tables.
- **Architectural Rules**:
  - Store all currency fields as `INTEGER` representing centavos (no `REAL`).
  - Store all quantities and multipliers as `INTEGER` representing millicounts (1.0 base unit = `1000`).
  - Add `is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1))` to `customers`, `suppliers`, and `inventory`.
  - Add `attempt_type TEXT CHECK(attempt_type IN ('PIN', 'DOP', 'MMP'))` to `login_attempts`.
  - Define separate `sales_invoice_number` and `official_receipt_number` columns.
- **Approval Metrics**:
  1. Running the SQL file creates all 24 tables.
  2. Running a validation query on table structures returns correct datatypes and column schemas.

#### Task 1.4: Database Core Seeds
- **Description**: Seed the default systemic records in `src/lib/db.ts` including the `SYSTEM` daemon account and initial Chart of Accounts.
- **Proposed SQL Seed**:
  ```sql
  INSERT OR IGNORE INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
  VALUES ('system-daemon', 'SYSTEM', 'SYSTEM Daemon', 'Admin', '0000000000000000000000000000000000000000000000000000000000000000', '0000000000000000', 1, 1);

  INSERT OR IGNORE INTO accounts (id, code, name, category, balance) VALUES
  ('acc-cash', '1010', 'Cash Drawer', 'Asset', 0),
  ('acc-ar', '1110', 'Accounts Receivable', 'Asset', 0),
  ('acc-inv', '1210', 'Inventory Asset', 'Asset', 0),
  ('acc-ap', '2010', 'Accounts Payable', 'Liability', 0);
  ```
- **Approval Metrics**:
  1. Bootstrapping the database seeds 1 systemic user with `is_system = 1`.
  2. Verification query returns seeded account codes in the accounts table.

#### Task 1.5: E2E Database Validation Runner
- **Description**: Create the standalone E2E validation script `scratch/verify-all-modules.js` to assert constraints, rate-limiters, and HMAC chain calculations.
- **Approval Metrics**:
  1. Running `node scratch/verify-all-modules.js` executes and exits with code `0`.
  2. All assertions log success outputs to the terminal.

---

### Phase 2: Server Actions & Backend Cryptographic Logic

#### Task 2.1: Key Derivation & AES-GCM Encryption Actions (`src/lib/crypto.ts`)
- **Description**: Build KDF (PBKDF2-SHA512) and AES-256-GCM encryption/decryption functions to secure sensitive client/supplier fields.
- **Key Requirements**:
  - DOP Derivation Iterations: `100,000`
  - MMP Derivation Iterations: `600,000`
- **Approval Metrics**:
  1. Encrypting a string produces a colon-separated value: `iv:tag:ciphertext`.
  2. Decrypting the ciphertext with the correct key recovers the exact original string.

#### Task 2.2: Store Unlock Server Action (`src/app/api/unlock/route.ts`)
- **Description**: Implement the store unlock endpoint verifying the DOP, decrypting the MLEK, and loading it into `global.mlekSecret`.
- **Architectural Rules**:
  - Enforce DOP complexity: 14+ characters, letters, numbers, and symbols.
  - Failures log a `STORE_UNLOCK_FAILED` event in the database.
- **Approval Metrics**:
  1. Entering a valid DOP decrypts the MLEK and sets `global.mlekSecret`.
  2. Failed entries return a 401 error and log attempts in the lockout tables.

#### Task 2.3: Lockout rate limit checks
- **Description**: Implement rate limiting on both PIN checkout, DOP unlock, and MMP recovery endpoints.
- **Throttling rules**:
  - 3 failures in 5 min locks the client IP for 5 min (all endpoints).
  - 5 failures in 15 min locks the PIN account globally for 15 min. (Unlock and recovery endpoints rely solely on IP throttling to prevent global local-network DoS attacks).
- **Approval Metrics**:
  1. Generating 3 failed requests from the same IP blocks the next request with a 429 status.
  2. Generating 5 global failures locks the screen for 15 minutes.

#### Task 2.4: Customer CRM Ledger & HMAC Chains (`src/lib/ledger.ts`)
- **Description**: Write `recordLedgerDebit` and `recordLedgerCredit` adding entries with HMAC-SHA256 signature chains.
- **Verification Rule**:
  $$\text{Current Hash} = \text{HMAC-SHA256}(\text{data} + \text{Prev Hash}, \text{global.mlekSecret})$$
- **Approval Metrics**:
  1. Every new ledger entry generates a signature chained to the previous ledger entry's signature.
  2. Modifying a ledger record's amount directly in the database breaks the chain, causing `verifyLedger()` to return `false`.

#### Task 2.5: General Ledger Double-Entry Transaction Action
- **Description**: Write the general ledger insertion helper enforcing $\text{Sum}(\text{Debits}) = \text{Sum}(\text{Credits})$ inside database transaction locks.
- **Approval Metrics**:
  1. Submitting journal entries where debits equal credits saves the record.
  2. Submitting mismatched lines throws an error, rolling back all balance changes.

#### Task 2.6: Delivery Dispatch Operations
- **Description**: Write dispatch actions updating status progress.
- **Quantities**: Load weights and aggregate counts must be written and deducted in **millicount integers**.
- **Approval Metrics**:
  1. Dispatching a shipment checks inventory and updates statuses.
  2. Shipped quantities are stored as scaled integers (e.g. `4000` for 4.0 cu.m).

#### Task 2.7: Shift Reconciliation & Z-Reading Engine
- **Description**: Write the shift close action. Summarize gross vatable, zero-rated, and tax exempt totals, verifying only cash payments count toward `shifts.expected_cash`.
- **Approval Metrics**:
  1. Closing a shift inserts a row in `shift_z_readings`.
  2. expected_cash excludes A/R ledger charge totals.

#### Task 2.8: Schema Migration Engine JS support
- **Description**: Update the migration script in `src/lib/db.ts` to execute programmatic JS/TS files that load `global.mlekSecret` to modify encrypted columns. (Use native `require` without `eval` strings to prevent code injection).
- **Approval Metrics**:
  1. Running migrations executes JS modules.
  2. Programmatic migrations successfully decrypt and migrate GCM-encrypted fields.

---

### Phase 3: Base UI Layout & Navigation

#### Task 3.1: Sidebar Navigation Layout
- **Description**: Build `src/components/SidebarNav.tsx` displaying options: POS, Inventory, CRM, Deliveries, Reports, and Maintenance.
- **Approval Metrics**:
  1. Shows selected states and supports responsive sizing.
  2. Lucide icons display cleanly.

#### Task 3.2: Dashboard Container Shell
- **Description**: Create `src/components/DashboardLayout.tsx` handling active viewports without page reloads.
- **Approval Metrics**:
  1. Navigating views updates the dashboard viewport instantly.
  2. Modals render centered floating over a clean, off-white canvas.

#### Task 3.3: App Page Integration
- **Description**: Mount the layouts inside `src/app/page.tsx`, initiating database clients.
- **Approval Metrics**:
  1. Dev server compiles components without React hydration exceptions.
  2. Server logs active database connections on boot.

#### Task 3.4: Tailwind CSS v4 Theme Cleanup
- **Description**: Configure theme color tokens in `src/app/globals.css` using `:root, .light` and `.dark` blocks. Dark mode: slate-950 backgrounds, emerald-500 accent. Light mode: slate-50 backgrounds, emerald-600 accent.
- **Approval Metrics**:
  1. Typography displays consistent dark colors for high-contrast readability.
  2. Theme styles apply uniformly across panels using a clean, data-dense dashboard structure with glass-panel cards.

---

### Phase 4: CRM Ledger & Stock UI Managers

#### Task 4.1: Stock Inventory Board
- **Description**: Build `src/components/InventoryManager.tsx` to list all stocks in a clean table with low stock alerts (when quantity <= reorder level).
- **Approval Metrics**:
  1. Low-stock rows are styled with red warning alerts.
  2. Search bar filters product lists by name or category.

#### Task 4.2: Product Creation & Restock Form Dialogs
- **Description**: Add dialog modals inside the Inventory manager for adding new products, suppliers, and purchase orders.
- **Approval Metrics**:
  1. Submitting the forms calls the server actions and updates the table view.
  2. Purchase order logs update inventory and record supplier names.

#### Task 4.3: Customer Accounts CRM Table
- **Description**: Create `src/components/CustomerManager.tsx` to list customers, phone numbers, addresses, credit limits, and current balances. Decrypt customer PII on render.
- **Approval Metrics**:
  1. Unpaid balance is clearly displayed for each customer.
  2. Customers exceeding credit limits are flagged.

#### Task 4.4: Chronological Customer Ledger View
- **Description**: Build a detailed ledger modal in the CRM view showing a chronological history of charges (`DEBIT`) and payments (`CREDIT`), and running balances.
- **Approval Metrics**:
  1. Ledger displays chronological debit/credit rows.
  2. Includes a print option to export the ledger statements.

#### Task 4.5: Payments Dialog Form
- **Description**: Implement a "Receive Payment" dialog inside the customer view to log a cash payment.
- **Approval Metrics**:
  1. Submitting a payment updates the customer balance and ledger log.
  2. The customer list balance drops instantly.

---

### Phase 5: POS Register & Cart Checkout

#### Task 5.1: POS Registers Sales Grid
- **Description**: Build `src/components/POSRegister.tsx` displaying products grouped by category as cards with fast filters.
- **Approval Metrics**:
  1. Clicking a card adds the item to the cart.
  2. Items list displays current stock availability on the card.

#### Task 5.2: POS Shopping Cart Controls
- **Description**: Implement the right-side shopping cart panel supporting item quantity modifications (decimals allowed for bulk aggregates), line price override, and line deletion.
- **Approval Metrics**:
  1. Cart totals recalculate correctly on item modifications.
  2. Price override is allowed (visual indication shows overridden prices).

#### Task 5.3: Cart Calculations & Totals
- **Description**: Implement subtotal, VAT calculation toggle (+12%), delivery fee input, and cart-wide discount input. The Server Action must recalculate the total using secure database prices and reject tampered payloads with a `MATH_TAMPERING_DETECTED` error.
- **Approval Metrics**:
  1. Grand total accurately matches: `(Subtotal - Discount) + Tax + Delivery Fee`.
  2. Grand total updates live as inputs change.

#### Task 5.4: Checkout split/credit check modal
- **Description**: Build checkout dialogue modal supporting customer mapping, payment type selection, down-payment split input, and checking credit limits.
- **Approval Metrics**:
  1. Credit account selection blocks if customer balance + due exceeds limit.
  2. Checkout submits data, empties cart, and loads print success dialog.

---

### Phase 6: Delivery Queue & A5 Print Engine

#### Task 6.1: Delivery Pending Queue
- **Description**: Build `src/components/DeliveryDispatch.tsx` showing a table of transactions with delivery status `Pending` or `Partially Delivered`.
- **Approval Metrics**:
  1. Lists matching customer name, transaction date, and progress ratio.
  2. Clicking transaction displays detail view showing items and quantities left to ship.

#### Task 6.2: Dispatch Trip Dialog Form
- **Description**: Implement a "Dispatch Trip" form where users can assign driver, truck plate, notes, and specific quantities loaded for delivery.
- **Approval Metrics**:
  1. Dispatched quantities must not exceed the remaining quantities.
  2. Dispatch updates quantities and changes status to `Fully Delivered` if all items are shipped.

#### Task 6.3: A5 Landscape Print Styles
- **Description**: Implement print-only styling wrapper component `src/components/A5PrintReceipt.tsx` styled to fit A5 landscape page margins (`size: A5 landscape`).
- **Approval Metrics**:
  1. Print view hides screen navs and buttons during print mode.
  2. Table fits exactly inside the 190mm width boundary.

#### Task 6.4: Print trigger hooks
- **Description**: Bind print triggers to the POS checkout success screen and historic delivery dispatches.
- **Approval Metrics**:
  1. Clicking print opens the native browser print preview.
  2. Preview margins are correct and default print orientation selects Landscape.

---

### Phase 7: Profit Reports & Role Access Controls

#### Task 7.1: Reports Dashboard
- **Description**: Build `src/components/ReportsPanel.tsx` listing key charts: daily sales (cash vs credit), accounts receivable aging list, and collections ledger.
- **Approval Metrics**:
  1. Cash collections and receivables totals calculate correctly.
  2. Lists all outstanding debts sorted by amount.

#### Task 7.2: Gross Profit Margin Metrics
- **Description**: Implement profit summaries using cost price data vs selling price data (`selling_price - cost_price`).
- **Approval Metrics**:
  1. Net Profit is calculated and shown on dashboard.
  2. Profit margin percentage displays correctly for each item in report.

#### Task 7.3: Manager Authorization Gateway Verification
- **Description**: Implement RBAC session checks (via secure, HttpOnly `iron-session` cookies) for privileged actions (adjusting product cost prices, manually updating inventory, or overriding customer credit limits). Action validation verifies:
  1. The authenticated user's session role is strictly `Manager` or `Admin`.
  2. `global.mlekSecret` is resident in server process memory, verifying the store was successfully unlocked with the DOP passphrase on boot.
- **Approval Metrics**:
  1. Privileged endpoints reject calls if role is `Cashier`, or if `global.mlekSecret` is null/empty.
  2. Access is granted only when the manager session is active and the DB key is loaded.

---

### Phase 8: Operations & Backup Utility

#### Task 8.1: Sales Returns UI
- **Description**: Add a Returns and Voids interface under a Maintenance panel to list transactions and select items to return.
- **Approval Metrics**:
  1. Processing a return registers on customer ledger statement and restocks inventory.
  2. Completed returns list displays transaction detail history correctly.

#### Task 8.2: Data Backup & Encryption Panel
- **Description**: Implement the dashboard backup manager interface:
  1. Displays the status logs of the nightly 11:00 PM worker_thread backup job.
  2. The manual "Export Backup" button executes the WAL-checkpoint backup API (`db.backup()`), encrypts the resultant file buffer via AES-256-GCM using the MLEK, and serves the encrypted zip download. Raw database.db file downloads are blocked.
- **Approval Metrics**:
  1. Clicking "Export Backup" downloads an encrypted file with prepended GCM IV and Tag metadata.
  2. The shift history lists historical cron backup audit trails.

---

### Phase 9: Security Integrity Check & Startup

#### Task 9.1: Cryptographic Audit Integrity Dashboard
- **Description**: Build an integrity checking page inside Maintenance. It calculates block-style hash chains of the `customer_ledger` records (each entry has a hash of itself combined with the previous entry's hash) and flags if any row has been modified in the database.
- **Approval Metrics**:
  1. Dashboard displays a green status showing `Ledger Database Integrity Intact`.
  2. Modifying a ledger row's amount in database triggers a red validation error `WARNING: Database Tampering Detected!`.

#### Task 9.2: App Linux launcher script
- **Description**: Create `run-app.sh` in the project root to start the production next build and automatically open the default web browser.
- **Approval Metrics**:
  1. Script runs from terminal.
  2. Boots server, opens browser tab to `http://localhost:3000`, and operates offline.

---

## Verification Plan

### Automated Tests
Execute the vitest logic test runner:
```bash
npm run test
```
Execute the complete integration test script validating schemas, locking triggers, and IP rate limits:
```bash
node scratch/verify-all-modules.js
```

### Manual Verification
1. Verify TLS Secure Context: Navigate to `https://construction-erp.local:3000` and check for green secure symbols.
2. Verify Shift Close Report: Process credit sales and cash checkouts. Verify that expected shift cash excludes accounts receivable credit checkouts.
3. Verify Soft Deletion Integrity: Soft-delete a customer record, then check historical ledger sheets to ensure transaction rows are still joined and legible.

---

## Phase 10: Security & Technical Audit Remediation
- **Objective:** Fix architectural, structural, and security gaps identified during the comprehensive codebase audit.
- **Tasks:**
  - [x] Fix SQLite constraint mismatch errors during zero-downtime migrations (`002_indexes_and_constraints.sql`).
  - [x] Hard-fail dynamic `require()` calls and refactor strictly to ES6 `import` syntax to satisfy bundler invariants.
  - [x] Cleanse and extract non-async dependencies (`createBalancedJournalEntry`) imported by Next.js Server Actions into neutral helper libraries (`ledger_helpers.ts`) to fix build errors.
  - [x] Correct math errors in partial credit calculations, VAT extractions, and decimal formatting.
  - [x] Replace OS-dependent tools (`netstat`/`lsof`) with POSIX-standard tools (`ss`) in launch scripts.
  - [x] Fix `shifts.ts` `ORDER BY` regression referencing dropped `start_time` column.
  - [x] Remove phantom `expected_cash` updates from `transactions.ts` on dropped column.
  - [x] Repair Manager override PIN authentication to query DB salts and use 600,000 iterations.
  - [x] Separate GL revenue recognition into `acc-revenue` and `acc-vat-payable`.
  - [x] Create `003_add_vat_payable.sql` and update seed.
  - [x] Revert VAT from `acc-vat-payable` proportionally during `processReturn` refunds.
  - [x] Correct Z-reading `vatable_sales` aggregate to strip inclusive tax for BIR compliance.
  - [x] Extend HMAC integrity chaining to Supplier Ledger (`004_hmac_hardening.sql`).
  - [x] Add ISO8601 timestamps to HMAC hash inputs to prevent replay attacks.
  - [x] Add robust memory-mapped Vitest suite for pure backend server action isolation.
  - [x] Finalize `Shift` typescript maps to strictly match the updated DB schema (`opened_at`, `closed_at`, `closing_cash_actual`, `z_reading_id`).
  - [x] Add `getSupplierLedger` action to fully parse and enforce the HMAC chain for supplier payables.
  - [x] Enforce `SESSION_PASSWORD` validation in production for iron-session.
  - [x] Replace `alert()` with `sonner` toast notifications for shift close feedback.
  - [x] Add explicit comment explaining combo-payment point-of-sale split logic for `acc-ar`.
  - [x] Fix TypeScript type mismatch in `isRestock` testing argument.
  - [x] Fix fractional display rounding in Delivery Dispatch using `formatQuantity()`.
  - [x] Fix test logic in `shifts.test.ts` to properly mock full `amount_paid` cashier match.
  - [x] Add UI warning regarding zero-rated reporting vs inclusive prices when VAT is disabled.
  - [x] Replace `alert()` popups in Maintenance Panel with `sonner` toast notifications.

---

### Phase 11: Final Security Hardening (Completed)

#### Task 11.1: Eliminate Hardcoded Credentials
- Removed hardcoded admin PIN `123456` from `bootstrapStore`
- Admin PIN is now cryptographically random 6-digit, displayed once at bootstrap
- System daemon user seeded with `crypto.randomBytes(32)` hash and `crypto.randomBytes(8)` salt
- Status: ✅ Complete

#### Task 11.2: Secure Backup Pipeline
- Backup temp files written to `os.tmpdir()` with UUID filenames
- Cleanup in `finally` block prevents lingering plaintext DB
- Backup encryption uses PBKDF2-derived key from MLEK (not raw MLEK reuse)
- Status: ✅ Complete

#### Task 11.3: Server-Side Price & Tax Validation
- `processCheckout` fetches customer `price_tier`, validates `unitPrice` against DB `selling_price`/`wholesale_price`
- Throws `PRICE_TAMPERING_DETECTED` on mismatch
- Tax recalculated server-side: `Math.round(((computedSubtotal - discount) / 1.12) * 0.12)`
- Client-supplied tax value is ignored
- Status: ✅ Complete

#### Task 11.4: TOCTOU Race Condition Fixes
- Delivery dispatch: `remaining_qty` validation moved inside `db.transaction()`
- Rate limiting: fail-count check and `login_attempts` INSERT in same transaction
- Status: ✅ Complete

---

### Phase 12: Structured Error Handling & Type Safety (Completed)

#### Task 12.1: Standardize Server Action Returns
- All 10 server action files wrapped in `try/catch`
- Uniform return type: `{ success: boolean; data?: T; error?: string }`
- `deactivateProduct` and `deactivateCustomer` check `info.changes === 0` for bad IDs
- `openShift` and `closeShift` validate non-negative inputs
- Status: ✅ Complete

#### Task 12.2: TypeScript Compliance
- Reduced `as any` casts to minimal necessary (DB row returns, test mocks)
- Removed all unused imports across server actions and shared libs
- `tsc --noEmit` passes with zero errors
- Status: ✅ Complete

#### Task 12.3: Production Logging
- All `console.log` statements in `db.ts` and `init.ts` gated behind `process.env.NODE_ENV !== 'production'`
- Status: ✅ Complete

---

### Phase 13: Testing & PWA (Completed)

#### Task 13.1: Component Test Coverage
- Added `PaymentModal.test.tsx` — renders modal correctly
- Added `POSRegister.test.tsx` — loads inventory, renders product grid
- Added `CheckoutModal.test.tsx` — renders with payment methods, submits checkout
- All component tests mock server actions via `vi.mock()`
- Status: ✅ Complete

#### Task 13.2: PWA / Offline Capability
- Added `public/manifest.json` with standalone display mode and theme colors
- Added `public/sw.js` service worker for static asset caching
- Added `src/components/ui/PWA.tsx` component for service worker registration
- Integrated into `src/app/layout.tsx`
- Status: ✅ Complete

#### Task 13.3: ErrorBoundary
- Added `src/components/ui/ErrorBoundary.tsx` wrapping dashboard views
- Individual tab crashes are isolated, preventing full SPA crashes
- Status: ✅ Complete

---

## Current Project Health (as of Phase 13)
- **Test Suites:** 10 (7 server action + 3 component)
- **Tests:** 20, all passing
- **TypeScript:** `tsc --noEmit` clean
- **Security:** Zero known vulnerabilities, zero hardcoded credentials
- **Migrations:** 5 SQL migrations
- **Server Actions:** 10, all with structured error returns
- **Components:** 20
- **Shared Libraries:** 9
