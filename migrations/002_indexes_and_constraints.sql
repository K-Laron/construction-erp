-- Indexes for Foreign Keys and common lookups
CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id ON transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_items_item_id ON transaction_items(item_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, timestamp);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier_id ON shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_transactions_cashier_id ON transactions(cashier_id);

-- Add constraints via recreation since SQLite lacks ALTER TABLE ADD CONSTRAINT

-- Recreate shifts table to fix column count and type mismatch
CREATE TABLE shifts_new (
  id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  opening_float INTEGER NOT NULL,
  closing_cash_actual INTEGER,
  status TEXT NOT NULL CHECK (status IN ('Open', 'Closed')),
  z_reading_id TEXT
);

INSERT INTO shifts_new (
  id, cashier_id, opened_at, closed_at, opening_float, closing_cash_actual, status
)
SELECT 
  id, cashier_id, start_time, end_time, opening_float, actual_cash, status
FROM shifts;

DROP TABLE shifts;
ALTER TABLE shifts_new RENAME TO shifts;

-- Recreate transactions to add status CHECK constraints and preserve ALL 16 columns
CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY,
  sales_invoice_number INTEGER UNIQUE,
  official_receipt_number INTEGER UNIQUE,
  customer_id TEXT,
  cashier_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax INTEGER DEFAULT 0,
  delivery_fee INTEGER DEFAULT 0,
  discount INTEGER DEFAULT 0,
  total_amount INTEGER NOT NULL,
  amount_paid INTEGER DEFAULT 0,
  balance_due INTEGER DEFAULT 0,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('Paid', 'Unpaid', 'Partial')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Credit', 'Check', 'Transfer')),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('Pending', 'Partially Delivered', 'Fully Delivered', 'N/A')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

INSERT INTO transactions_new (
  id, sales_invoice_number, official_receipt_number, customer_id, cashier_id, date, subtotal, tax, delivery_fee, discount, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status
)
SELECT 
  id, sales_invoice_number, official_receipt_number, customer_id, cashier_id, date, subtotal, tax, delivery_fee, discount, total_amount, amount_paid, balance_due, payment_status, payment_method, delivery_status
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

-- Update the Official Receipt Trigger to assign OR numbers to all Cash/Service transactions (Task 4.2)
DROP TRIGGER IF EXISTS assign_document_numbers;
CREATE TRIGGER assign_document_numbers
AFTER INSERT ON transactions
FOR EACH ROW
BEGIN
  -- Sales Invoice Number if goods exist
  UPDATE transactions
  SET sales_invoice_number = COALESCE((SELECT MAX(sales_invoice_number) FROM transactions), 10000) + 1
  WHERE id = NEW.id AND NEW.subtotal > 0;

  -- Official Receipt Number for Cash payments or if delivery fee is charged
  UPDATE transactions
  SET official_receipt_number = COALESCE((SELECT MAX(official_receipt_number) FROM transactions), 50000) + 1
  WHERE id = NEW.id AND (NEW.delivery_fee > 0 OR NEW.payment_method = 'Cash');
END;


