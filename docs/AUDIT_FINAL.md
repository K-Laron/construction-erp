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
