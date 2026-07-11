# Plan 003: FIFO invoice allocation on customer payments

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> ```bash
> git diff --stat cb7bb9b..HEAD -- \
>   src/app/actions/customers.ts \
>   src/app/actions/transactions.ts \
>   src/app/actions/__tests__/transactions.test.ts
> ```
> Also re-read `recordPayment` and the FIFO block inside `processReturn` for the
> allocation pattern to reuse.
>
> **Prerequisite:** Plan 002 should be DONE (G/L fail-closed + payment matrix).
> If 002 is not merged, you may still implement allocation, but run full
> transaction + customer tests carefully.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — touches A/R aging correctness; must keep HMAC ledger + G/L balanced
- **Depends on**: plans/002-gl-fail-closed-payment-matrix.md
- **Category**: bug
- **Planned at**: commit `cb7bb9b`, 2026-07-11

## Why this matters

`recordPayment` reduces `customers.current_balance` and posts Cash/AR G/L, but
**never** reduces `transactions.balance_due` on open invoices. After a customer
“pays in full” at the CRM payment modal, invoices can still show unpaid balances.
Returns already implement FIFO invoice reduction; payments must do the same so
credit control, collections, and Z-reading-adjacent reports stay consistent.

## Current state

### `recordPayment` today (`src/app/actions/customers.ts` ~117–171)

```typescript
export async function recordPayment(customerId: string, amount: number, description: string): Promise<...> {
  // requireAuth + zod...
  db.transaction(() => {
    db.prepare(`UPDATE customers SET current_balance = current_balance - ? WHERE id = ?`)
      .run(parsed.amount, parsed.customerId);
    // HMAC customer_ledger CREDIT ...
    createBalancedJournalEntry(..., [
      { accountId: 'acc-cash', type: 'DEBIT', amount: parsed.amount },
      { accountId: 'acc-ar', type: 'CREDIT', amount: parsed.amount }
    ], cashierId);
  })();
}
```

No touch of `transactions`.

### FIFO pattern already used in returns (`transactions.ts` ~416–432)

```typescript
const otherTxns = db.prepare(`
  SELECT id, balance_due FROM transactions
  WHERE customer_id = ? AND balance_due > 0 AND id != ?
  ORDER BY date ASC
`).all(...) ;

let remainingOverall = overallCreditRefund;
const updateTxnBalance = db.prepare(
  "UPDATE transactions SET balance_due = balance_due - ? WHERE id = ?"
);
for (const oTx of otherTxns) {
  if (remainingOverall <= 0) break;
  const toReduce = Math.min(remainingOverall, oTx.balance_due);
  updateTxnBalance.run(toReduce, oTx.id);
  remainingOverall -= toReduce;
}
```

Reuse this pattern for payments (all open invoices for customer, oldest first).

### Also update payment_status

When reducing `balance_due`, set:

- `balance_due === 0` → `payment_status = 'Paid'`
- `0 < balance_due < total_amount` (or amount_paid context) → `'Partial'`
- Prefer:
  ```sql
  UPDATE transactions
  SET balance_due = ?,
      payment_status = CASE WHEN ? <= 0 THEN 'Paid' WHEN ? < total_amount THEN 'Partial' ELSE payment_status END
  ```
  Simpler approach after each reduce:
  ```typescript
  const newBal = oTx.balance_due - toReduce;
  const status = newBal <= 0 ? 'Paid' : 'Partial';
  db.prepare(`UPDATE transactions SET balance_due = ?, payment_status = ? WHERE id = ?`)
    .run(Math.max(0, newBal), status, oTx.id);
  ```

### Overpayment policy (locked)

- Payment amount must not exceed `customers.current_balance` (outstanding A/R).
- If `parsed.amount > current_balance`, throw  
  `OVERPAYMENT_NOT_ALLOWED: Payment exceeds customer outstanding balance.`
- Do **not** create customer credit liability in this plan (no negative balances).

### HMAC / ledger

- Keep single customer_ledger CREDIT for the full payment amount (as today).
- `reference_id` may remain null or set to first allocated txn id — **keep null** unless you have a multi-ref table (out of scope).
- G/L stays one Cash/AR entry for full amount (allocation is subledger only).

### UI

`src/components/crm/PaymentModal.tsx` — no change required if server validates.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `npx vitest run src/app/actions/__tests__/transactions.test.ts` | pass |
| New/extended | `npx vitest run src/app/actions/__tests__/customers_payments.test.ts` or transactions suite | pass |
| Full | `npm test` | pass |
| Typecheck | `npx tsc --noEmit` | exit 0 |

## Scope

**In scope:**

- `src/app/actions/customers.ts` (`recordPayment` only; maybe small shared helper)
- Optional: `src/lib/ar_allocation.ts` if you extract FIFO for reuse with returns — **nice-to-have, not required**
- Tests: create `src/app/actions/__tests__/customers_payments.test.ts` **or** add to `transactions.test.ts`
- `plans/README.md` status

**Out of scope:**

- Supplier payment invoice allocation (no supplier invoice table like POS txns)
- Partial payment application UI (choose invoices manually)
- Changing Z-reading collection queries
- Refunds that re-open invoices beyond existing `processReturn` logic

## Git workflow

- Branch: `advisor/003-invoice-payment-allocation`
- Commit: `fix: allocate customer payments to invoices FIFO`
- Do NOT push unless instructed

## Steps

### Step 1: Write failing tests

Create `src/app/actions/__tests__/customers_payments.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import db from '@/lib/db';
import { processCheckout } from '../transactions';
import { recordPayment } from '../customers';
```

#### Test 1 — Payment reduces oldest invoice first

1. Insert customer credit_limit large, balance 0, not vat exempt.
2. Create **two** credit sales (paymentMethod Credit, amountPaid 0) for same customer:
   - Sale A: total 1000 (use selling prices that match)
   - Sale B: total 2000  
   Use VAT-exempt customer to avoid tax math friction (`is_vat_exempt = 1`).
3. Confirm `current_balance === 3000`, both tx `balance_due` correct.
4. `recordPayment(customerId, 1000, 'Partial collection')`
5. Assert:
   - customer.current_balance === 2000
   - oldest tx balance_due === 0, payment_status === 'Paid'
   - newer tx balance_due === 2000
6. Assert G/L: cash DEBIT 1000, AR CREDIT 1000 for this payment (sum accounts after clearing journals only if isolated — better query journal_entries by description or count increase).

#### Test 2 — Payment spanning two invoices

- Same setup, pay 2500.
- Oldest fully paid, second balance_due === 500, status Partial.
- customer.current_balance === 500.

#### Test 3 — Overpay rejected

- balance 1000, pay 1001 → success false, `/OVERPAYMENT|exceed/i`.

#### Test 4 — Payment when no open invoices but balance > 0 (data anomaly)

If balance > 0 but no rows with balance_due > 0:

- Still allow reducing customer.current_balance and posting G/L/ledger (historical inconsistency recovery), **or** reject.  
- **This plan chooses:** still post customer balance + ledger + G/L; allocation loop no-ops. Document in comment. Test optional.

**Verify** tests fail on allocation assertions before fix.

### Step 2: Implement allocation inside `recordPayment` transaction

Inside the existing `db.transaction`, **order of operations**:

1. Load customer `current_balance` with  
   `SELECT current_balance FROM customers WHERE id = ?`.  
   If missing → throw not found.  
   If `parsed.amount > current_balance` → throw OVERPAYMENT.
2. FIFO allocate:
   ```typescript
   const openTxns = db.prepare(`
     SELECT id, balance_due, total_amount FROM transactions
     WHERE customer_id = ? AND balance_due > 0
     ORDER BY date ASC, id ASC
   `).all(parsed.customerId) as { id: string; balance_due: number; total_amount: number }[];

   let remaining = parsed.amount;
   const updateTxn = db.prepare(`
     UPDATE transactions SET balance_due = ?, payment_status = ? WHERE id = ?
   `);
   for (const tx of openTxns) {
     if (remaining <= 0) break;
     const toApply = Math.min(remaining, tx.balance_due);
     const newBal = tx.balance_due - toApply;
     const status = newBal <= 0 ? 'Paid' : 'Partial';
     updateTxn.run(newBal, status, tx.id);
     remaining -= toApply;
   }
   ```
3. Update customer balance: `current_balance = current_balance - amount` (same as today).
4. Customer ledger HMAC CREDIT (unchanged).
5. G/L Cash/AR (unchanged).

Use `ORDER BY date ASC, id ASC` for deterministic FIFO (secondary key).

### Step 3: Align amount_paid on invoices? (optional, recommended)

When applying `toApply`, also:

```typescript
db.prepare(`UPDATE transactions SET amount_paid = amount_paid + ? WHERE id = ?`)
  .run(toApply, tx.id);
```

Only if `amount_paid` column is used by UI/reports. Schema has `amount_paid`. **Do this** so invoice paid totals stay coherent.

### Step 4: Green + full suite

```bash
npx vitest run src/app/actions/__tests__/customers_payments.test.ts
npx vitest run src/app/actions/__tests__/transactions.test.ts
npm test
npx tsc --noEmit
```

### Step 5: README status DONE

## Test plan

| Case | Expected |
|------|----------|
| Pay oldest first | first invoice Paid, second untouched |
| Pay across two invoices | correct residual on second |
| Overpay | rejected; no partial apply |
| Existing processReturn credit tests | still pass |
| HMAC integrity after payment | optional: `getCustomerLedger` isIntegrityViolated false |

## Done criteria

- [ ] `recordPayment` reduces `transactions.balance_due` FIFO
- [ ] Updates `payment_status` and `amount_paid`
- [ ] Rejects payment > current_balance
- [ ] G/L + customer_ledger still posted once per payment
- [ ] New tests pass; full suite green
- [ ] Scope respected; README updated

## STOP conditions

- Plan 002 not applied and cash/credit checkout cannot create reliable AR balances for tests — apply 002 first or seed `transactions` + `customers.current_balance` manually in tests without checkout.
- You think you need a new DB table for payment applications — stop; use in-place balance_due updates only.
- Double-entry would break if allocation amount ≠ payment amount — allocation is subledger only; G/L stays full payment.

## Maintenance notes

- Future “apply to specific invoice” UI can replace FIFO loop with selected IDs.
- Reviewers: ensure sum of allocated `toApply` equals `min(payment, sum(open balance_due))` and leftover only when data anomalous.
- Consider extracting shared `allocateToInvoices(customerId, amount)` used by returns and payments later.
