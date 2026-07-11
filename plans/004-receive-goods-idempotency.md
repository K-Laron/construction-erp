# Plan 004: Idempotent goods receipt (prevent double stock / AP)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> ```bash
> git diff --stat cb7bb9b..HEAD -- \
>   src/app/actions/inventory.ts \
>   src/app/actions/__tests__/inventory.test.ts
> ```

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED (guards write path; wrong status check could block legitimate receives)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `cb7bb9b`, 2026-07-11

## Why this matters

`receiveGoods` always marks a PO `Received` and re-applies stock, supplier AP, and G/L every call. A double-click or retry **doubles inventory and liability**. Production receiving must be idempotent: only `Draft` (or equivalent unreceived) POs can be received once.

## Current state

### `receiveGoods` (`src/app/actions/inventory.ts` ~215–306)

```typescript
db.transaction(() => {
  // 1. Mark PO as Received
  db.prepare("UPDATE purchase_orders SET status = 'Received' WHERE id = ?").run(parsed.purchaseOrderId);
  // ... stock WAC, supplier ledger, G/L — no status pre-check
})();
```

### Schema status values (`migrations/001_initial_schema.sql`)

```sql
status TEXT CHECK(status IN ('Draft', 'Sent', 'Received', 'Cancelled')) DEFAULT 'Draft'
```

`createPurchaseOrder` inserts status `'Draft'`.

### Existing test

`src/app/actions/__tests__/inventory.test.ts` — WAC on receive (1 test). Preserve it.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Inventory tests | `npx vitest run src/app/actions/__tests__/inventory.test.ts` | all pass |
| Full | `npm test` | all pass |
| Typecheck | `npx tsc --noEmit` | exit 0 |

## Scope

**In scope:**

- `src/app/actions/inventory.ts` (`receiveGoods` only)
- `src/app/actions/__tests__/inventory.test.ts`
- `plans/README.md` status

**Out of scope:**

- PO UI workflow (Draft → Sent → Received)
- Partial receipts / multi-GRN per PO
- Supplier payment changes

## Git workflow

- Branch: `advisor/004-receive-goods-idempotency`
- Commit: `fix: reject double receiveGoods on non-Draft POs`
- Do NOT push unless instructed

## Steps

### Step 1: Failing test — double receive

In `inventory.test.ts`, add:

1. Create supplier + product + PO via `createPurchaseOrder` (or direct SQL if auth mocks needed).  
   Note: `createPurchaseOrder` requires Manager session — default vitest session is `system-daemon` Admin, OK if user exists. Seed ensures system-daemon; Admin role may need a real user — existing inventory test already calls `receiveGoods` successfully; follow that setup.

2. `receiveGoods(poId, 'x')` → success, stock increased by Q.

3. Second `receiveGoods(poId, 'x')` → `success === false`, error matches  
   `/ALREADY_RECEIVED|INVALID_PO_STATUS|Received/i`

4. Stock quantity **unchanged** after second call.
5. Supplier balance not doubled (if Credit PO).

**Verify** second call currently succeeds (bug) → after fix, fails cleanly.

### Step 2: Status guard inside transaction

At the **start** of the `db.transaction` in `receiveGoods`:

```typescript
const poRow = db.prepare(
  "SELECT status, supplier_id, total_cost, payment_method FROM purchase_orders WHERE id = ?"
).get(parsed.purchaseOrderId) as {
  status: string;
  supplier_id: string;
  total_cost: number;
  payment_method: 'Cash' | 'Credit';
} | undefined;

if (!poRow) {
  throw new Error('PO_NOT_FOUND: Purchase order does not exist.');
}

// Allow receive from Draft or Sent; block Received and Cancelled
if (poRow.status === 'Received') {
  throw new Error('ALREADY_RECEIVED: This purchase order was already received.');
}
if (poRow.status === 'Cancelled') {
  throw new Error('PO_CANCELLED: Cannot receive a cancelled purchase order.');
}
if (poRow.status !== 'Draft' && poRow.status !== 'Sent') {
  throw new Error(`INVALID_PO_STATUS: Cannot receive PO in status ${poRow.status}.`);
}
```

Then:

```typescript
const upd = db.prepare(
  "UPDATE purchase_orders SET status = 'Received' WHERE id = ? AND status IN ('Draft', 'Sent')"
).run(parsed.purchaseOrderId);

if (upd.changes === 0) {
  throw new Error('ALREADY_RECEIVED: Concurrent receive or invalid status.');
}
```

Use the **atomic UPDATE … WHERE status IN (...)** as the concurrency-safe lock (TOCTOU-safe with the check). Prefer relying primarily on `changes === 0` after conditional update; the explicit SELECT is for clearer error messages.

Reuse `poRow` fields instead of a second SELECT for supplier_id/total_cost/payment_method.

### Step 3: Green tests

```bash
npx vitest run src/app/actions/__tests__/inventory.test.ts
npm test
npx tsc --noEmit
```

### Step 4: README DONE

## Test plan

| Case | Expected |
|------|----------|
| First receive | success; stock/WAC as today |
| Second receive | fail ALREADY_RECEIVED; stock unchanged |
| Missing PO | fail PO_NOT_FOUND |
| Existing WAC test | still pass |

## Done criteria

- [ ] Conditional status update prevents double receive
- [ ] Tests cover double-receive
- [ ] Full suite green
- [ ] README updated

## STOP conditions

- UI creates POs with a status other than Draft/Sent that must still be receivable — report and list statuses found in code/UI.
- Concurrent double-receive still doubles stock under stress — ensure UPDATE WHERE status clause is used; do not only SELECT then UPDATE without status filter.

## Maintenance notes

- Partial receipts later need `goods_receipts` multiplicity + remaining qty; current model is one-shot full receive.
- Reviewer: confirm Credit AP and inventory G/L only once.
