# Plan 002: Fail-closed G/L posting + correct Cash/Credit/Check debit matrix

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> ```bash
> git diff --stat cb7bb9b..HEAD -- \
>   src/app/actions/transactions.ts \
>   src/lib/ledger_helpers.ts \
>   src/app/actions/__tests__/transactions.test.ts
> ```
> Re-read live `processCheckout` G/L section if it diverges from excerpts below.

## Status

- **Priority**: P1
- **Effort**: M (half day with thorough tests)
- **Risk**: MED — changes financial posting; must preserve existing cash happy path and return tests
- **Depends on**: none (plan 003 depends on this)
- **Category**: bug
- **Planned at**: commit `cb7bb9b`, 2026-07-11

## Why this matters

`processCheckout` builds G/L lines then **silently skips** `createBalancedJournalEntry` when debits ≠ credits. The sale still commits. That means POS can record revenue while the general ledger never sees the transaction — fatal for a double-entry ERP and BIR-oriented reporting.

Separately, the debit matrix is wrong for:

- **Credit + down payment**: cash received is never debited; only AR for `balanceDue` is.
- **Check**: never debits cash; only AR when `balanceDue > 0`. Fully paid Check posts **only credits** → silent G/L drop.

Production-grade rule: **every successful sale posts a balanced journal or the whole checkout rolls back.**

## Current state

### Money model (do not change)

- Amounts are **integer centavos** (100 = ₱1.00).
- Quantities are **millicounts** (1000 = 1 unit).
- Prices are **VAT-inclusive** for normal customers.
- Server tax:  
  `tax = isVatExempt ? 0 : Math.round(((computedSubtotal - discount + deliveryFee) / 1.12) * 0.12)`  
  (Option A: delivery fee is vatable.)
- `totalAmount` must equal `subtotal - discount + deliveryFee` (client-submitted, revalidated).
- `balanceDue = totalAmount - amountPaid` (today; plan 005 may clamp overpay — for this plan, **reject** `amountPaid > totalAmount`).

### Broken G/L block (`src/app/actions/transactions.ts` ~254–286)

```typescript
    if (paymentMethod === 'Cash' && amountPaid > 0) {
      glLines.push({ accountId: 'acc-cash', type: 'DEBIT', amount: amountPaid });
    }
    if ((paymentMethod === 'Credit' || paymentMethod === 'Check') && balanceDue > 0) {
      glLines.push({ accountId: 'acc-ar', type: 'DEBIT', amount: balanceDue });
    }
    // For POS combo payments (e.g. paying part in cash, remainder goes to credit)
    if (paymentMethod === 'Cash' && amountPaid > 0 && balanceDue > 0) {
      glLines.push({ accountId: 'acc-ar', type: 'DEBIT', amount: balanceDue });
    }

    const revenueAmount = totalAmount - tax;
    glLines.push({ accountId: 'acc-revenue', type: 'CREDIT', amount: revenueAmount });
    if (tax > 0) {
      glLines.push({ accountId: 'acc-vat-payable', type: 'CREDIT', amount: tax });
    }

    // COGS ...

    if (totalDebits === totalCredits && totalDebits > 0) {
      createBalancedJournalEntry(`POS Sale: ${transactionId.slice(0, 8)}`, glLines, cashierId);
    }
```

### Account IDs (seeded in `src/lib/db.ts`)

| id | meaning |
|----|---------|
| `acc-cash` | Cash Drawer |
| `acc-ar` | Accounts Receivable |
| `acc-inv` | Inventory Asset |
| `acc-vat-payable` | VAT Payable |
| `acc-revenue` | Sales Revenue |
| `acc-cost-of-sales` | Cost of Sales |

### Nested transactions

`createBalancedJournalEntry` in `src/lib/ledger_helpers.ts` uses `db.transaction()`. It is already nested inside `processCheckout`’s `db.transaction()`. better-sqlite3 supports nested transactions via savepoints. **Keep calling `createBalancedJournalEntry` inside the outer transaction** so a journal failure rolls back the sale.

### Existing test to preserve

`src/app/actions/__tests__/transactions.test.ts` — `'records correct GL entries on checkout and return'` expects cash sale VAT credit 120 and revenue credit 1000. Must still pass.

### Conventions

- Errors: throw `Error('CODE: message')` inside transaction; outer catch returns `{ success: false, error }`.
- Prefer small pure helper for building sale G/L lines so tests can unit-test the matrix without full checkout if useful.
- Prefer-const lint: if `let remainingRefund` still exists ~line 392, fix to `const` while editing this file.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Transaction tests | `npx vitest run src/app/actions/__tests__/transactions.test.ts` | all pass |
| Full tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 for files you touch |

## Scope

**In scope:**

- `src/app/actions/transactions.ts`
- Optionally extract helper to `src/lib/pos_gl.ts` (create) if it keeps `transactions.ts` readable — **allowed**
- `src/app/actions/__tests__/transactions.test.ts`
- `plans/README.md` status only

**Out of scope:**

- Changing tax formula (Option A stays)
- `processReturn` G/L rewrite (only fix if a test proves regression from your sale change)
- Invoice payment allocation (plan 003)
- Check register / PDC clearing via `checks` table (treat Check as cash-like at POS for now)
- Chart of accounts redesign

## Target debit matrix (authoritative)

For every sale with `totalAmount > 0`:

```
DEBIT  acc-cash   amountPaid     (if amountPaid > 0)   // Cash AND Check
DEBIT  acc-ar     balanceDue     (if balanceDue > 0)   // remainder / credit
CREDIT acc-revenue   (totalAmount - tax)
CREDIT acc-vat-payable  tax      (if tax > 0)
// plus COGS if costOfGoods > 0:
DEBIT  acc-cost-of-sales  costOfGoods
CREDIT acc-inv            costOfGoods
```

**Invariants (assert before posting):**

1. `amountPaid + balanceDue === totalAmount` (after server clamps/rejects)
2. `amountPaid >= 0`, `balanceDue >= 0`
3. Sum of asset/expense debits (cash+AR+COGS) equals sum of credits (revenue+VAT+inv)  
   Equivalently: cash+AR+COGS === (totalAmount - tax) + tax + COGS === totalAmount + COGS

**Reject before insert:**

- `amountPaid > totalAmount` → throw `OVERPAYMENT_NOT_ALLOWED: ...` (server-side; UI may still clamp)

**Fail-closed:**

```typescript
// After building glLines including COGS:
const totalDebits = ...;
const totalCredits = ...;
if (totalDebits !== totalCredits || totalDebits === 0) {
  throw new Error(
    `GL_UNBALANCED: debits=${totalDebits} credits=${totalCredits} txn=${transactionId}`
  );
}
createBalancedJournalEntry(`POS Sale: ${transactionId.slice(0, 8)}`, glLines, cashierId);
```

Never skip the journal for a successful sale with `totalAmount > 0`.

If `totalAmount === 0` (edge free sale): STOP and report if this can occur; otherwise throw `INVALID_TOTAL` rather than posting empty journal.

## Git workflow

- Branch: `advisor/002-gl-fail-closed-payment-matrix`
- Commit: `fix: fail-closed G/L and correct credit/check cash debits`
- Do NOT push unless instructed

## Steps

### Step 1: Characterization tests first (red)

In `src/app/actions/__tests__/transactions.test.ts`, add tests that **document current desired behavior** (they may fail on current code — that is intended).

Helper to sum GL:

```typescript
function sumAccount(accountId: string, type: 'DEBIT' | 'CREDIT') {
  return (db.prepare(
    `SELECT COALESCE(SUM(amount),0) as total FROM journal_lines WHERE account_id = ? AND type = ?`
  ).get(accountId, type) as { total: number }).total;
}
```

Clear journals at start of each new test:  
`DELETE FROM journal_lines; DELETE FROM journal_entries;`

#### Test A — Credit with down payment posts Cash + AR

Setup:

- Customer with high credit_limit
- Item selling_price = 1000 (centavos), qty 1000 millicounts → subtotal 1000
- VAT-exempt customer OR use tax-aware totals carefully  
  **Simplest:** use `is_vat_exempt = 1` so tax=0, totalAmount=1000
- paymentMethod `Credit`, amountPaid `400`, balanceDue should be `600`

Assert after success:

- `sumAccount('acc-cash','DEBIT') === 400`
- `sumAccount('acc-ar','DEBIT') === 600`
- `sumAccount('acc-revenue','CREDIT') === 1000`
- journal entry exists for this sale
- customer.current_balance === 600 (only balanceDue hits AR/ledger — existing behavior)

#### Test B — Check full payment posts Cash, not silent skip

- No customer required if cash-like; use customer null, paymentMethod `Check`, amountPaid = totalAmount, tax-exempt path or full tax path
- Assert `acc-cash` DEBIT === totalAmount
- Assert revenue posted
- Assert at least one journal_entries row created for the sale

#### Test C — Unbalanced path cannot commit (implementation detail)

After Step 2 this is structural. Optionally spy is hard; instead assert:  
if somehow lines wrong, checkout fails — covered by fail-closed + Test A/B.

#### Test D — Overpayment rejected

- Cash amountPaid = totalAmount + 1  
- expect `success === false` and error matches `/OVERPAYMENT/`

**Verify**:
```bash
npx vitest run src/app/actions/__tests__/transactions.test.ts
```
→ Tests A/B/D should **fail** on unfixed code (or pass if already fixed — then skip to verify-only).

### Step 2: Implement server overpay rejection

Near top of validated checkout logic (after parse, before/at balanceDue):

```typescript
if (amountPaid > totalAmount) {
  throw new Error('OVERPAYMENT_NOT_ALLOWED: amountPaid cannot exceed totalAmount.');
}
const balanceDue = totalAmount - amountPaid;
```

### Step 3: Replace debit matrix

Replace the three `if` payment blocks with:

```typescript
if (amountPaid > 0) {
  glLines.push({ accountId: 'acc-cash', type: 'DEBIT', amount: amountPaid });
}
if (balanceDue > 0) {
  glLines.push({ accountId: 'acc-ar', type: 'DEBIT', amount: balanceDue });
}
```

**Do not** special-case Cash vs Credit vs Check for G/L cash/AR split.  
**Keep** existing Credit customer_ledger logic that posts DEBIT for `balanceDue` only when `paymentMethod === 'Credit' && customerId && balanceDue > 0`.

Note: For `paymentMethod === 'Cash' && balanceDue > 0` (partial cash), AR debit is correct (customer owes remainder) **only if** a customer exists. Today the system allows cash partial without customer.

**Required policy for this plan:**

- If `balanceDue > 0` and `!customerId`, throw:  
  `CUSTOMER_REQUIRED_FOR_BALANCE: Partial payment requires a customer to hold AR.`  
- This prevents orphan AR.

Implement that check before entering the DB transaction (or at start of it).

### Step 4: Fail-closed journal post

Replace silent `if (balanced)` with throw-if-unbalanced then always call `createBalancedJournalEntry` for sales where `totalAmount > 0`.

If COGS lines make amounts large, still balance: cash+AR+COGS = revenue+VAT+inv.

### Step 5: Fix prefer-const if present

In `processReturn`, change `let remainingRefund` to `const remainingRefund` if eslint flags it.

### Step 6: Green tests + full suite

```bash
npx vitest run src/app/actions/__tests__/transactions.test.ts
npm test
npx tsc --noEmit
npm run lint
```

All pass.

### Step 7: Update `plans/README.md` row 002 → DONE

## Test plan

| Case | Expected |
|------|----------|
| Existing cash GL + return | still pass |
| Credit down payment | cash debit + AR debit + revenue; customer balance = balanceDue |
| Check full pay | cash debit; journal exists |
| Overpayment | rejected |
| Partial cash without customer | rejected with CUSTOMER_REQUIRED_FOR_BALANCE |
| Pure credit amountPaid 0 | AR debit only; existing credit tests pass |

Model new tests after existing `transactions.test.ts` style (inline inserts, no external fixtures).

## Done criteria

- [ ] No `if (totalDebits === totalCredits && totalDebits > 0) { create... }` silent skip remains for POS sale path
- [ ] Grep: `rg "totalDebits === totalCredits && totalDebits > 0" src/app/actions/transactions.ts` returns no match (or only fail-closed throw path)
- [ ] Credit down payment test passes with cash+AR debits
- [ ] Check full payment posts journal
- [ ] `npm test` and `tsc --noEmit` exit 0
- [ ] Scope respected
- [ ] README status DONE

## STOP conditions

- Changing the tax formula appears necessary to balance G/L — stop; tax is VAT-inclusive extraction; debits should use `totalAmount` not pre-tax.
- `createBalancedJournalEntry` nested transaction throws differently than outer catch expects — fix by ensuring throw propagates; do not remove balance check inside helper.
- Existing return tests fail because return VAT allocation interacts with new sales — investigate; do not disable return tests.
- Product owner requires Check to go to a separate "Checks on Hand" account — stop and report; schema has no such account seeded (would need new account seed + migration).

## Maintenance notes

- Plan 003 will allocate payments against invoices; sale-time AR must remain equal to open invoice balances.
- Reviewers: walk through Credit partial and Check with a spreadsheet of centavos.
- Deferred: undeposited checks sub-ledger (`checks` table).
