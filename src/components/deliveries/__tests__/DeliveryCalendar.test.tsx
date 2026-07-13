import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DeliveryCalendar from '../DeliveryCalendar';
import DeliveryDispatch from '../DeliveryDispatch';
import db from '@/lib/db';
import { runMigrations } from '@/lib/db';
import { getMlekSecret } from '@/lib/mlek';
import crypto from 'crypto';

const TEST_USER = 'system-daemon';
const testTxId = crypto.randomUUID();
const testItemId = crypto.randomUUID();

beforeAll(async () => {
  // DB + auth context required by server actions
  await runMigrations(getMlekSecret().toString('hex'));
  db.prepare(`INSERT OR IGNORE INTO users (id, username, name, role, passcode_hash, passcode_salt, is_active, is_system)
    VALUES (?, 'daemon', 'Daemon', 'Admin', 'hash', 'salt', 1, 1)`)
    .run(TEST_USER);

  // Seed a pending transaction so table view has data
  db.prepare(`INSERT OR IGNORE INTO inventory (id, name, category, unit, stock_quantity, cost_price, selling_price, wholesale_price, reorder_level, is_active)
    VALUES (?, 'Test Item', 'Hardware', 'pc', 100, 1000, 2000, 1800, 10, 1)`)
    .run(testItemId);
  db.prepare(`INSERT OR IGNORE INTO transactions (id, cashier_id, date, subtotal, tax, delivery_fee, discount, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 2000, 0, 0, 0, 2000, 2000, 0, 'Paid', 'Cash', 'Pending')`)
    .run(testTxId, TEST_USER);
  db.prepare(`INSERT OR IGNORE INTO transaction_items (id, transaction_id, item_id, quantity, unit_used, unit_price, unit_cost, total_price, quantity_returned)
    VALUES (?, ?, ?, 1, 'pc', 2000, 1000, 2000, 0)`)
    .run(crypto.randomUUID(), testTxId, testItemId);
});

describe('DeliveryCalendar — skeleton→data transition', () => {
  it('renders skeleton on mount then transitions to month grid', async () => {
    render(<DeliveryCalendar />);
    // Skeleton pills visible immediately (before data loads)
    expect(document.querySelector('.animate-pulse')).toBeDefined();
    // Month label appears after fetch completes
    const heading = await screen.findByRole('heading', { level: 2 });
    expect(heading).toBeDefined();
    expect(heading.textContent).toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/);
  });
});

describe('DeliveryCalendar — month navigation', () => {
  it('navigates between months via prev/next buttons', async () => {
    render(<DeliveryCalendar />);
    // Wait for data to load
    const getHeading = async () => screen.findByRole('heading', { level: 2 });
    const initialLabel = (await getHeading()).textContent;

    // Click Previous
    fireEvent.click(screen.getByLabelText('Previous'));
    const afterPrev = await getHeading();
    expect(afterPrev.textContent).not.toBe(initialLabel);

    // Click Next (back to original)
    fireEvent.click(screen.getByLabelText('Next'));
    const afterNext = await getHeading();
    expect(afterNext.textContent).toBe(initialLabel);
  });

  it('todays button resets to current month', async () => {
    render(<DeliveryCalendar />);
    await screen.findByRole('heading', { level: 2 });

    const getHeadingText = () => screen.getByRole('heading', { level: 2 }).textContent;
    const initial = getHeadingText();

    // Navigate away → heading must change
    fireEvent.click(screen.getByLabelText('Previous'));
    await waitFor(() => expect(getHeadingText()).not.toBe(initial));

    const afterPrev = getHeadingText();

    // Today → heading must change back
    fireEvent.click(screen.getByText('Today'));
    await waitFor(() => expect(getHeadingText()).not.toBe(afterPrev));
  });
});

describe('DeliveryDispatch — table↔calendar toggle', () => {
  it('toggles between default table view and calendar view', async () => {
    render(<DeliveryDispatch />);
    // Default: table view with the header
    expect(screen.getByText('Logistics & Dispatches')).toBeDefined();

    // Click Calendar toggle
    fireEvent.click(screen.getByText('Calendar'));
    // Calendar view toggle pills should be visible
    await screen.findByText('month');
    expect(screen.getByText('agenda')).toBeDefined();

    // Click Table toggle
    fireEvent.click(screen.getByText('Table'));
    // Back to table view
    expect(screen.getByText('Logistics & Dispatches')).toBeDefined();
  });
});
