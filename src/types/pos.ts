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
  quantity: number;
  unit_used: string;
  unit_price: number;
  unit_cost: number;
  total_price: number;
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
