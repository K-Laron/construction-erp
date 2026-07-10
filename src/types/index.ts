export interface User {
  id: string;
  username: string;
  name: string;
  role: 'Cashier' | 'Manager' | 'Admin';
  passcode_hash: string;
  passcode_salt: string;
  is_active: number; // 0 or 1
  is_system: number; // 0 or 1
}

export interface LoginAttempt {
  id: string;
  attempt_type: 'PIN' | 'DOP' | 'MMP';
  username: string;
  ip_address: string;
  timestamp: number;
  is_successful: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null; // Encrypted AES-256-GCM
  address: string | null; // Encrypted AES-256-GCM
  credit_limit: number; // Stored in centavos
  current_balance: number; // Stored in centavos
  price_tier: 'Retail' | 'Wholesale';
  is_vat_exempt: number;
  is_active: number;
  created_at: string;
}

export interface JobSite {
  id: string;
  customer_id: string;
  name: string;
  address: string;
  contact_person: string | null;
  phone: string | null;
}

export interface CustomerLedgerEntry {
  id: string;
  customer_id: string;
  date: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number; // Stored in centavos
  reference_id: string | null;
  description: string;
  hmac_signature: string | null;
}

export interface Check {
  id: string;
  ledger_entry_id: string;
  check_number: string;
  bank_name: string;
  check_date: string;
  status: 'Pending' | 'Cleared' | 'Bounced';
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock_quantity: number; // Stored in millicounts
  cost_price: number; // Stored in centavos
  selling_price: number; // Stored in centavos
  wholesale_price: number; // Stored in centavos
  reorder_level: number; // Stored in millicounts
  is_active: number;
}

export interface UnitConversion {
  id: string;
  item_id: string;
  from_unit: string;
  to_unit: string;
  multiplier: number; // Stored as millicount scaling (e.g. 4000 = 4.0x)
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null; // Encrypted
  email: string | null; // Encrypted
  current_balance: number; // Stored in centavos
  is_active: number;
}

export interface SupplierLedgerEntry {
  id: string;
  supplier_id: string;
  date: string;
  type: 'CHARGE' | 'PAYMENT';
  amount: number; // Stored in centavos
  reference_id: string | null;
  description: string | null;
  hmac_signature: string | null;
}

export interface Quotation {
  id: string;
  customer_id: string;
  date: string;
  total_amount: number;
  status: 'Draft' | 'Sent' | 'Accepted' | 'Expired';
}

export interface SalesOrder {
  id: string;
  customer_id: string;
  quotation_id: string | null;
  date: string;
  total_amount: number;
  status: 'Pending' | 'Processing' | 'Invoiced' | 'Cancelled';
}

export interface Transaction {
  id: string;
  sales_invoice_number: number | null;
  official_receipt_number: number | null;
  customer_id: string | null;
  cashier_id: string;
  date: string;
  subtotal: number;
  tax: number;
  delivery_fee: number;
  discount: number;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  payment_status: string;
  payment_method: string;
  delivery_status: string;
}

export interface TransactionItem {
  id: string;
  transaction_id: string;
  item_id: string;
  quantity: number; // Millicounts
  unit_used: string;
  unit_price: number; // Centavos
  unit_cost: number; // Centavos
  total_price: number; // Centavos
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  date: string;
  total_cost: number;
  payment_method: 'Cash' | 'Credit';
  status: 'Draft' | 'Sent' | 'Received' | 'Cancelled';
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  item_id: string;
  quantity: number; // Millicounts
  unit_price: number; // Centavos
  total_cost: number; // Centavos
}

export interface GoodsReceipt {
  id: string;
  purchase_order_id: string;
  date: string;
  received_by: string;
}

export interface Delivery {
  id: string;
  transaction_id: string;
  delivery_date: string;
  driver_name: string;
  truck_plate: string;
  status: 'Pending' | 'Dispatched' | 'Delivered';
}

export interface DeliveryItem {
  id: string;
  delivery_id: string;
  item_id: string;
  quantity_delivered: number; // Millicounts
}

export interface Shift {
  id: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  closing_cash_actual: number | null;
  z_reading_id: string | null;
  status: 'Open' | 'Closed';
}

export interface ShiftZReading {
  id: string;
  shift_id: string;
  date: string;
  gross_sales: number;
  vat_collected: number;
  vatable_sales: number;
  exempt_sales: number;
  total_voids: number;
  total_returns: number;
  total_collections: number;
}

export interface Worker {
  id: string;
  name: string;
  role: 'Helper' | 'Driver' | 'Block Maker';
  phone: string | null;
  pay_rate: number; // Centavos
  is_active: number;
}

export interface Timecard {
  id: string;
  worker_id: string;
  date: string;
  hours_worked: number;
}

export interface ProductionLog {
  id: string;
  worker_id: string;
  date: string;
  item_id: string;
  quantity: number; // Millicounts
  earnings: number; // Centavos
}

export interface Payslip {
  id: string;
  worker_id: string;
  date_disbursed: string;
  period_start: string;
  period_end: string;
  hourly_earnings: number;
  piece_earnings: number;
  total_earnings: number;
}

export interface FixedAsset {
  id: string;
  name: string;
  purchase_date: string;
  purchase_cost: number;
  salvage_value: number;
  useful_life_years: number;
  accumulated_depreciation: number;
}

export interface CashVoucher {
  id: string;
  date: string;
  pay_to: string;
  amount: number;
  category: 'Utilities' | 'Rent' | 'Office Supplies' | 'Maintenance' | 'Other';
  notes: string | null;
}

export interface FleetExpense {
  id: string;
  truck_plate: string;
  date: string;
  expense_type: 'Fuel' | 'Maintenance' | 'Toll' | 'Other';
  amount: number;
  notes: string | null;
}

export interface SystemConfig {
  key: string;
  value: string;
}

export interface SystemAuditLog {
  id: string;
  timestamp: string;
  user_id: string | null;
  action_type: string;
  reference_id: string | null;
  old_value: string | null;
  new_value: string | null;
}
