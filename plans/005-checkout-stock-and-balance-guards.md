# Plan 005: Checkout hardening — stock pre-check, overpay clamp, AR/AP floors

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
>   src/app/actions/customers.ts \
>   src/app/actions/inventory.ts \
>   src/app/actions/__tests__/transactions.test.ts
> ```
>
> **Prerequisite:** Plan 002 should already reject overpayment on checkout and
> use the unified debit matrix. This plan adds stock checks and balance floors
> on payment endpoints.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-gl-fail-closed-payment-matrix.md
- **Category**: bug
- **Planned at**: commit `cb7bb9b`, 2026-07-11

## Why this matters

1. **Stock:** Schema has `CHECK(stock_quantity >= 0)`, so oversell rolls back with a raw SQLite error. Cashiers need `INSUFFICIENT_STOCK` with item id/name.
2. **Customer payments:** `recordPayment` can push `current_balance` negative if amount > balance (plan 003 adds overpay reject; this plan ensures floor even if 003 not done).
3. **Supplier payments:** `recordSupplierPayment` can drive `suppliers.current_balance` negative without guard.

## Current state

### Checkout stock path (`transactions.ts` ~198–208)

```typescript
const deductStock = db.prepare("UPDATE inventory SET stock_quantity = stock_quantity - ? WHERE id = ?");
// ...
const invItem = db.prepare("SELECT stock_quantity FROM inventory WHERE id = ?").get(item.itemId) as { stock_quantity: number };
const newStock = invItem.stock_quantity - item.quantity;
deductStock.run(item.quantity, item.itemId);
```

No pre-check; relies on CHECK constraint.

### Supplier payment (`inventory.ts` ~345–349)

```typescript
db.prepare(`UPDATE suppliers SET current_balance = current_balance - ? WHERE id = ?`)
  .run(parsed.amount, parsed.supplierId);
```

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `npx vitest run src/app/actions/__tests__/transactions.test.ts src/app/actions/__tests__/inventory.test.ts` | pass |
| Full | `npm test` | pass |
| Typecheck | `npx tsc --noEmit` | exit 0 |

## Scope

**In scope:**

- `src/app/actions/transactions.ts` — stock pre-check inside checkout transaction
- `src/app/actions/customers.ts` — payment ≤ balance (if not already from plan 003)
- `src/app/actions/inventory.ts` — supplier payment ≤ balance
- Related tests
- `plans/README.md` status

**Out of scope:**

- Soft-reserve stock across long-lived carts
- Negative stock admin override workflow

## Target behavior

### Stock (inside `db.transaction`, before deduct)

For each cart line:

```typescript
const invItem = db.prepare(
  "SELECT stock_quantity, name FROM inventory WHERE id = ?"
).get(item.itemId) as { stock_quantity: number; name: string } | undefined;
if (!invItem) throw new Error(`Item ${item.itemId} not found.`);
if (invItem.stock_quantity < item.quantity) {
  throw new Error(
    `INSUFFICIENT_STOCK: ${invItem.name} has ${invItem.stock_quantity} millicounts, need ${item.quantity}`
  );
}
```

Optionally use atomic:

```sql
UPDATE inventory SET stock_quantity = stock_quantity - ?
WHERE id = ? AND stock_quantity >= ?
```

and if `changes === 0`, throw INSUFFICIENT_STOCK (best for concurrency). **Prefer atomic UPDATE.**

### Customer payment floor

If plan 003 not present, add:

```typescript
const cust = db.prepare("SELECT current_balance FROM customers WHERE id = ?").get(...) 
if (parsed.amount > cust.current_balance) throw new Error('OVERPAYMENT_NOT_ALLOWED: ...');
```

### Supplier payment floor

```typescript
const sup = db.prepare("SELECT current_balance FROM suppliers WHERE id = ?").get(parsed.supplierId)
if (!sup) throw new Error('SUPPLIER_NOT_FOUND');
if (parsed.amount > sup.current_balance) {
  throw new Error('OVERPAYMENT_NOT_ALLOWED: Payment exceeds supplier outstanding balance.');
}
```

## Steps

### Step 1: Tests

1. Checkout quantity > stock → `success false`, `/INSUFFICIENT_STOCK/`.
2. Concurrent-style: stock 1000 millicounts, sell 1000 succeeds; second sell fails (can be sequential in test).
3. Supplier payment > balance → fail.
4. Customer payment > balance → fail (skip if already covered in plan 003 tests).

### Step 2: Implement atomic stock deduct + payment floors

### Step 3: Full verify

```bash
npm test && npx tsc --noEmit
```

### Step 4: README DONE

## Done criteria

- [ ] Insufficient stock returns clear error; no reliance on raw SQLITE_CONSTRAINT alone
- [ ] Atomic `stock_quantity >= ?` update used
- [ ] Customer and supplier payments cannot exceed outstanding balances
- [ ] Tests pass; suite green

## STOP conditions

- Business allows overselling (backorders) — stop and report; current schema CHECK forbids negative stock.
- Plan 003 already implements customer floor — do not duplicate conflicting error codes; reuse `OVERPAYMENT_NOT_ALLOWED`.

## Maintenance notes

- POS UI can pre-disable oversell; server remains source of truth.
- Reviewer: concurrency test in `rbac_and_concurrency.test.ts` should still pass (sells down to zero, not below).
