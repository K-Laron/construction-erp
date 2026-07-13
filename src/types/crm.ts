export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  current_balance: number;
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
  amount: number;
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
