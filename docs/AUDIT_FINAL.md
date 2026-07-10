# Final Audit Resolution

This document summarizes the final state of the Construction Supply ERP audit.

## High-Severity (Fixed & Verified)
- **H1 (Balance Math):** Implemented `MAX(0, balance - ?)` in customer payments to prevent negative balances.
- **H2 (Cashier Scoping):** Added `cashier_id` to `customer_ledger` and scoped all collections in shift queries by the active cashier.
- **H3 (Entropy):** Replaced hardcoded mnemonic with 2048-word BIP39 dictionary.
- **H4 (Discount Override):** Enforced server-side `verifyOverride` for any discount greater than 0.
- **H5 (PIN Strength):** Added server-side validation to enforce PINs $\ge$ 6 characters.

## Critical Regressions (Fixed)
- **R1 (Credit Return Cashier ID):** Fixed `ReferenceError` during `processReturn` of credit sales by mapping `cashierId` to `processedBy`.
- **R2 (TS Import Error):** Removed phantom `getMlekSecret` import from `customers.ts`.

## Minor / Low-Severity (Fixed)
- **L2 (Maintenance Max Qty):** `MaintenancePanel.tsx` now correctly calculates max input by dividing millicounts by 1000.
- **L3 (SQL HAVING vs GROUP BY):** `deliveries.ts` rewritten using a CTE to ensure correct evaluation of `remaining_qty > 0`.
- **L5 (Dispatch Modal):** Initialized default quantities using formatted string conversion (`toString()`) instead of localized `formatQuantity`.

## Testing
All 7 tests across 5 test suites (Auth, Inventory, Ledger, Shifts, Transactions) are fully passing. 0 TypeScript regressions remain.

## Phase 4 Final Fixes
- **C1 & H3 (Pricing Integrity):** Server-side `unitPrice` validation was implemented. `processCheckout` now fetches the correct price tier (Retail/Wholesale) and asserts strict equality against the client payload to prevent price tampering. Added specific test coverage.
- **C2 (Tax Underreporting):** Forced server-side tax recalculation using VAT-inclusive logic `Math.round(((computedSubtotal - discount) / 1.12) * 0.12)`.
- **H2 (Backup Encryption Key Reuse):** Mitigated key-reuse vulnerability by deriving a specific backup encryption key from the master MLEK via PBKDF2.
- **H4 (Overpayment Clamping):** Reverted the `MAX(0, balance - amount)` clamp in customer payments to correctly allow negative balances (store credit) on overpayments.
- **M2 (Dispatch Quantity Verification):** Added server-side validation to ensure dispatched quantities never exceed the transaction's remaining quantity.
- **M4 (Session Security):** Eliminated the predictable fallback password in `session.ts`. Added a securely generated random fallback for development/testing, and strictly enforce the `SESSION_PASSWORD` env var in production.
- **M6 (Manager Override UI):** Fixed `CheckoutModal.tsx` dependency logic to correctly prompt for the manager override PIN when a discount is applied, rather than silently blocking submission.

## Phase 5 Final Hardening and Refinements (N5, N7, N8, N10)
- **Test Infrastructure Hardening (N5):** Fixed all tests that mutated immutable DB schema (`PRAGMA writable_schema`, `sqlite_master`). Test suites now reliably pass.
- **SQLite Portability (N7):** Ported non-portable SQLite functions to agnostic formats. Replaced `datetime('now')` with `CURRENT_TIMESTAMP` across 14 codebase files to standardize UTC timestamp behavior and support broader SQL compatibility. Removed `PRAGMA foreign_keys=OFF` from schema migrations.
- **UI Error Resilience (N8):** Introduced a global `ErrorBoundary` component (`src/components/ui/ErrorBoundary.tsx`) and wrapped the active dashboard view inside `page.tsx`. A crash in one specific dashboard tab (e.g. POS or Inventory) now isolates the error, preventing the entire SPA from crashing and displaying a fatal route error.

## Phase 6 Final Remaining Cleanups (L1-L5)
- **L1 (Global Fallback Removal):** Removed `(global as any).__activeUserId || 'system-daemon'` from `customers.ts:119` and correctly passed `cashierId`.
- **L2 (Worker DB Path):** Removed hardcoded `'data/database.db'` path in `src/lib/workers/reportQuery.js`. The `dbPath` is now dynamically passed through `workerData` from the main thread, making it work for dynamically assigned database files in tests or production.
- **L4 (Test Coverage Gaps):** Added test coverage in `transactions.test.ts` for Credit returns, VAT-exempt checkout flow, and full order cancellations (returns).
- **L5 (Stock Audit Trail):** Added direction-aware stock movement logging. Every `STOCK_IN` (receive goods, returns) and `STOCK_OUT` (sales/checkouts) now logs an explicit trace containing old stock quantity and new stock quantity directly into `system_audit_logs`.

## Phase 7 Prioritized Improvements
- **H1 (Hardcoded Admin PIN):** The `bootstrapStore` function now generates a cryptographically random 6-digit PIN for the default `admin` account instead of `123456`, displaying it once during initial setup in the `<UnlockScreen>`.
- **H2 (Unencrypted Backup Temp File):** Backups now write `VACUUM INTO` to the OS temporary directory (`os.tmpdir()`) with a UUID filename, and safely clean up via a `try/catch` in a `finally` block to prevent lingering plaintext DB files.
- **H3 (System Daemon Zero Hash):** The `system-daemon` user is now seeded using `crypto.randomBytes(32)` for its hash and `crypto.randomBytes(8)` for its salt, eliminating the zero-hash vulnerability.
- **M2 (Unused Imports):** Ran a comprehensive cleanup across `src/app/actions` and `src/lib`, removing all unused `crypto`, `mlek`, and type imports to resolve ESLint noise.
- **M3 & M4 (Transaction TOCTOU Races):** 
  - **Delivery Validation:** `remaining_qty` checks are now performed synchronously inside the `db.transaction()` block in `dispatchDelivery`.
  - **Rate-Limiting:** IP and Account lockout checks in `authenticateUser` are now isolated inside a `db.transaction()` which optimistically inserts an `is_successful = 0` attempt before yielding to the slow `pbkdf2Sync` hash check, updating to `1` only if the hash matches.
- **L1 (Production Console Logs):** Filtered non-critical `console.log` statements in `db.ts` and `init.ts` behind a `process.env.NODE_ENV !== 'production'` check.
