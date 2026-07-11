# Plan 006: Fix Z-reading vatable sales to match VAT Option A

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> ```bash
> git diff --stat cb7bb9b..HEAD -- \
>   src/app/actions/shifts.ts \
>   src/app/actions/transactions.ts \
>   src/app/actions/__tests__/shifts.test.ts
> ```

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED for tax reporting — numbers change; needs correct formula, not just tests green
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `cb7bb9b`, 2026-07-11

## Why this matters

Checkout (Option A) extracts VAT from the **VAT-inclusive** base:

```text
taxBase = subtotal - discount + deliveryFee
tax = round(taxBase / 1.12 * 0.12)   // when not VAT-exempt
```

Z-reading currently computes:

```sql
SUM(CASE WHEN tax > 0 THEN (subtotal - discount) - tax ELSE 0 END) as vatable_sales
```

That **omits deliveryFee** from the vatable base, so `vatable_sales + vat_collected` will not reconcile to the taxable portion of gross sales when delivery fees exist. Shift close reports become non-compliant / non-reconcilable.

## Current state

### Tax at sale (`transactions.ts` ~126–127)

```typescript
tax = isVatExempt ? 0 : Math.round(((computedSubtotal - discount + deliveryFee) / 1.12) * 0.12);
```

### Z-reading aggregate (`shifts.ts` ~91–99)

```typescript
const salesAgg = db.prepare(`
  SELECT 
    COALESCE(SUM(total_amount), 0) as gross_sales,
    COALESCE(SUM(tax), 0) as vat_collected,
    COALESCE(SUM(CASE WHEN tax > 0 THEN (subtotal - discount) - tax ELSE 0 END), 0) as vatable_sales,
    COALESCE(SUM(CASE WHEN tax = 0 THEN subtotal - discount ELSE 0 END), 0) as exempt_sales
  FROM transactions 
  WHERE cashier_id = ? AND date >= ? AND date <= ?
`).get(...)
```

### Identity that must hold for taxable sales

For each taxable transaction:

```text
vatable_sales_line ≈ (subtotal - discount + delivery_fee) - tax
vat_collected_line = tax
vatable_sales_line + vat_collected_line ≈ subtotal - discount + delivery_fee
```

And `total_amount` should equal `subtotal - discount + delivery_fee`.

Exempt sales should include delivery when tax is 0:

```text
exempt_sales_line = subtotal - discount + delivery_fee   // when tax = 0
```

(Today exempt ignores delivery_fee too.)

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Shift tests | `npx vitest run src/app/actions/__tests__/shifts.test.ts` | pass |
| Full | `npm test` | pass |
| Typecheck | `npx tsc --noEmit` | exit 0 |

## Scope

**In scope:**

- `src/app/actions/shifts.ts` — SQL aggregates in `closeShift` only
- `src/app/actions/__tests__/shifts.test.ts`
- Optionally assert helpers in `transactions.test.ts` if you add a pure tax helper — not required
- `plans/README.md` status

**Out of scope:**

- Changing Option A tax policy
- BIR form export PDF
- Rewriting historical `shift_z_readings` rows (no migration required unless operator requests)

## Target SQL

Replace vatable/exempt expressions with:

```sql
COALESCE(SUM(
  CASE WHEN tax > 0
    THEN (subtotal - discount + delivery_fee) - tax
    ELSE 0
  END
), 0) AS vatable_sales,

COALESCE(SUM(
  CASE WHEN tax = 0
    THEN (subtotal - discount + delivery_fee)
    ELSE 0
  END
), 0) AS exempt_sales
```

Keep `gross_sales = SUM(total_amount)` and `vat_collected = SUM(tax)`.

### Sanity check after close (optional assert in code)

After computing aggregates, if you want defensive logging:

```typescript
// Do not throw in production close for rounding; tests assert exact values.
```

Rounding: per-line tax already rounded; sum of `(base - tax)` may differ from `sum(base) - sum(tax)` by a few centavos across many lines — **use the same per-row expression** as above (sum of per-row bases net of tax), not global recompute.

## Steps

### Step 1: Failing test in `shifts.test.ts`

Extend or replace the thin shift test:

1. Open shift as authenticated cashier (mock session).
2. Create taxable item price 11200 (₱112.00), deliveryFee 1120 on checkout, discount 0.  
   - tax = round((11200+1120)/1.12*0.12) = round(12320/1.12*0.12) = round(11000*0.12) = 1320  
   - vatable net = 12320 - 1320 = 11000
3. Close shift with actualCash whatever expected.
4. Read `shift_z_readings` for that shift:
   - `vat_collected === 1320`
   - `vatable_sales === 11000`
   - `gross_sales === 12320`

Use VAT non-exempt customer/null customer as in other tests.

If openShift/closeShift session mocking is awkward, insert a closed shift row + call only the aggregate SQL via exporting a pure function — **prefer** testing through `closeShift` for integration fidelity.

### Step 2: Fix SQL in `closeShift`

Apply target SQL.

### Step 3: Verify

```bash
npx vitest run src/app/actions/__tests__/shifts.test.ts
npm test
npx tsc --noEmit
```

### Step 4: README DONE

## Done criteria

- [ ] Vatable/exempt formulas include `delivery_fee`
- [ ] Test with delivery fee proves `vatable_sales + vat_collected === subtotal - discount + delivery_fee` for the taxable fixture
- [ ] Full suite green

## STOP conditions

- Stakeholder decides delivery is **non-vatable** (Option B) — stop; that requires changing **both** checkout tax and Z-reading, out of this plan’s single-file intent.
- `closeShift` test cannot authenticate — follow session mock pattern from `rbac_and_concurrency.test.ts`; if still blocked, report.

## Maintenance notes

- Any future tax rate change must update checkout + Z-reading together.
- Reviewer: confirm BIR users know Option A (delivery vatable) is in effect.
- Document Option A in `docs/operator/DEPLOYMENT.md` if not already clear (optional one-line; stay in scope only if operator asks — default: skip docs).
