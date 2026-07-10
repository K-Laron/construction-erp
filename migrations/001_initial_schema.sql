-- 1. General Ledger Chart of Accounts
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT CHECK(category IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')) NOT NULL,
  balance INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  created_by TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  type TEXT CHECK(type IN ('DEBIT', 'CREDIT')) NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- 2. Staff & Authentication
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT CHECK(role IN ('Cashier', 'Manager', 'Admin')) NOT NULL,
  passcode_hash TEXT NOT NULL,
  passcode_salt TEXT NOT NULL,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  is_system INTEGER DEFAULT 0 CHECK(is_system IN (0, 1))
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  attempt_type TEXT CHECK(attempt_type IN ('PIN', 'DOP', 'MMP')) NOT NULL,
  username TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  is_successful INTEGER NOT NULL
);

-- 3. Customer Accounts & Job Sites
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT, -- Encrypted AES-256-GCM
  address TEXT, -- Encrypted AES-256-GCM
  credit_limit INTEGER DEFAULT 0 CHECK(credit_limit >= 0),
  current_balance INTEGER DEFAULT 0,
  price_tier TEXT CHECK(price_tier IN ('Retail', 'Wholesale')) DEFAULT 'Retail',
  is_vat_exempt INTEGER DEFAULT 0 CHECK(is_vat_exempt IN (0, 1)),
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_sites (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- 4. Customer Credit Ledger & PDCs
CREATE TABLE IF NOT EXISTS customer_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT CHECK(type IN ('DEBIT', 'CREDIT')) NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  reference_id TEXT,
  description TEXT NOT NULL,
  hmac_signature TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  ledger_entry_id TEXT NOT NULL,
  check_number TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  check_date TEXT NOT NULL,
  status TEXT CHECK(status IN ('Pending', 'Cleared', 'Bounced')) DEFAULT 'Pending',
  FOREIGN KEY (ledger_entry_id) REFERENCES customer_ledger(id) ON DELETE CASCADE
);

-- 5. Inventory & Converted Units
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock_quantity INTEGER DEFAULT 0 CHECK(stock_quantity >= 0), -- Millicounts
  cost_price INTEGER NOT NULL CHECK(cost_price >= 0),
  selling_price INTEGER NOT NULL CHECK(selling_price >= 0),
  wholesale_price INTEGER NOT NULL CHECK(wholesale_price >= 0),
  reorder_level INTEGER DEFAULT 0 CHECK(reorder_level >= 0), -- Millicounts
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS unit_conversions (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  from_unit TEXT NOT NULL,
  to_unit TEXT NOT NULL,
  multiplier INTEGER NOT NULL CHECK(multiplier > 0), -- Millicount multiplier
  FOREIGN KEY (item_id) REFERENCES inventory(id) ON DELETE CASCADE
);

-- 6. Suppliers & Accounts Payable
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT, -- Encrypted
  email TEXT, -- Encrypted
  current_balance INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT CHECK(type IN ('CHARGE', 'PAYMENT')) NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  reference_id TEXT,
  description TEXT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
);

-- 7. Sales Quotes & Orders
CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  date TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  status TEXT CHECK(status IN ('Draft', 'Sent', 'Accepted', 'Expired')) DEFAULT 'Draft',
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  quotation_id TEXT,
  date TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  status TEXT CHECK(status IN ('Pending', 'Processing', 'Invoiced', 'Cancelled')) DEFAULT 'Pending',
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (quotation_id) REFERENCES quotations(id)
);

-- 8. POS Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  sales_invoice_number INTEGER UNIQUE,
  official_receipt_number INTEGER UNIQUE,
  customer_id TEXT,
  cashier_id TEXT NOT NULL,
  date TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax INTEGER DEFAULT 0,
  delivery_fee INTEGER DEFAULT 0,
  discount INTEGER DEFAULT 0,
  total_amount INTEGER NOT NULL,
  amount_paid INTEGER DEFAULT 0,
  balance_due INTEGER DEFAULT 0,
  payment_status TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (cashier_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transaction_items (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0), -- Millicounts
  quantity_returned INTEGER DEFAULT 0 CHECK(quantity_returned >= 0),
  unit_used TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL CHECK(unit_cost >= 0),
  total_price INTEGER NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory(id)
);

-- Document Number Assignment Trigger
CREATE TRIGGER IF NOT EXISTS assign_document_numbers
AFTER INSERT ON transactions
FOR EACH ROW
BEGIN
  UPDATE transactions
  SET sales_invoice_number = COALESCE((SELECT MAX(sales_invoice_number) FROM transactions), 10000) + 1
  WHERE id = NEW.id AND NEW.subtotal > 0;

  UPDATE transactions
  SET official_receipt_number = COALESCE((SELECT MAX(official_receipt_number) FROM transactions), 50000) + 1
  WHERE id = NEW.id AND (NEW.delivery_fee > 0 OR NEW.payment_method = 'Cash');
END;

-- 9. Supplier Purchases
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  date TEXT NOT NULL,
  total_cost INTEGER NOT NULL,
  payment_method TEXT CHECK(payment_method IN ('Cash', 'Credit')) NOT NULL,
  status TEXT CHECK(status IN ('Draft', 'Sent', 'Received', 'Cancelled')) DEFAULT 'Draft',
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0), -- Millicounts
  unit_price INTEGER NOT NULL,
  total_cost INTEGER NOT NULL,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory(id)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL,
  date TEXT NOT NULL,
  received_by TEXT NOT NULL,
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
  FOREIGN KEY (received_by) REFERENCES users(id)
);

-- 10. Logistics & Dispatches
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  truck_plate TEXT NOT NULL,
  status TEXT CHECK(status IN ('Pending', 'Dispatched', 'Delivered')) DEFAULT 'Pending',
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS delivery_items (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity_delivered INTEGER NOT NULL CHECK(quantity_delivered > 0), -- Millicounts
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory(id)
);

-- 11. Labor, Shifts, & Payroll
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  cashier_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  opening_float INTEGER NOT NULL,
  expected_cash INTEGER,
  actual_cash INTEGER,
  discrepancy INTEGER,
  status TEXT CHECK(status IN ('Open', 'Closed')) DEFAULT 'Open',
  FOREIGN KEY (cashier_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS shift_z_readings (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  gross_sales INTEGER NOT NULL,
  vat_collected INTEGER NOT NULL,
  vatable_sales INTEGER NOT NULL,
  exempt_sales INTEGER NOT NULL,
  total_voids INTEGER NOT NULL,
  total_returns INTEGER NOT NULL,
  total_collections INTEGER NOT NULL,
  FOREIGN KEY (shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT CHECK(role IN ('Helper', 'Driver', 'Block Maker')) NOT NULL,
  phone TEXT,
  pay_rate INTEGER DEFAULT 0 CHECK(pay_rate >= 0),
  is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS timecards (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  date TEXT NOT NULL,
  minutes_worked INTEGER NOT NULL CHECK(minutes_worked >= 0),
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS production_logs (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  date TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0), -- Millicounts
  earnings INTEGER NOT NULL,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES inventory(id)
);

CREATE TABLE IF NOT EXISTS payslips (
  id TEXT PRIMARY KEY,
  worker_id TEXT NOT NULL,
  date_disbursed TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  hourly_earnings INTEGER NOT NULL,
  piece_earnings INTEGER NOT NULL,
  total_earnings INTEGER NOT NULL,
  FOREIGN KEY (worker_id) REFERENCES workers(id)
);

CREATE TABLE IF NOT EXISTS delivery_helpers (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- 12. Assets & General Expenses
CREATE TABLE IF NOT EXISTS fixed_assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  purchase_cost INTEGER NOT NULL CHECK(purchase_cost > 0),
  salvage_value INTEGER DEFAULT 0 CHECK(salvage_value >= 0),
  useful_life_years INTEGER NOT NULL CHECK(useful_life_years > 0),
  accumulated_depreciation INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cash_vouchers (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  category TEXT CHECK(category IN ('Utilities', 'Rent', 'Office Supplies', 'Maintenance', 'Other')) NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS fleet_expenses (
  id TEXT PRIMARY KEY,
  truck_plate TEXT NOT NULL,
  date TEXT NOT NULL,
  expense_type TEXT CHECK(expense_type IN ('Fuel', 'Maintenance', 'Toll', 'Other')) NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  notes TEXT
);

-- 13. System Configuration Store
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 14. Non-Ledger Security Auditing
CREATE TABLE IF NOT EXISTS system_audit_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  user_id TEXT,
  action_type TEXT NOT NULL,
  reference_id TEXT,
  old_value TEXT,
  new_value TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
