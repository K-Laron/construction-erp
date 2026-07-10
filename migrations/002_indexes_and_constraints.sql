-- Indexes for Foreign Keys and common lookups
CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_item_id ON transaction_items(item_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, timestamp);

-- Add constraints via recreation since SQLite lacks ALTER TABLE ADD CONSTRAINT
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- Recreate shifts table to fix shift_status constraint typo
CREATE TABLE shifts_new (
  id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  opening_float INTEGER NOT NULL,
  closing_cash_actual INTEGER,
  status TEXT NOT NULL CHECK (status IN ('Open', 'Closed')),
  z_reading_id TEXT
);
INSERT INTO shifts_new SELECT * FROM shifts;
DROP TABLE shifts;
ALTER TABLE shifts_new RENAME TO shifts;
CREATE INDEX IF NOT EXISTS idx_shifts_cashier_id ON shifts(cashier_id);

-- Recreate transactions to add status CHECK constraints
CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
  cashier_id TEXT NOT NULL REFERENCES users(id),
  total_amount INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL,
  balance_due INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Credit', 'Check', 'Transfer')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('Paid', 'Unpaid', 'Partial')),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('Pending', 'Partially Delivered', 'Fully Delivered', 'N/A')),
  sales_invoice_number INTEGER UNIQUE,
  official_receipt_number INTEGER UNIQUE
);
INSERT INTO transactions_new SELECT * FROM transactions;
DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;
CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_cashier_id ON transactions(cashier_id);

COMMIT;
PRAGMA foreign_keys=ON;
