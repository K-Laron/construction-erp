export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock_quantity: number;
  cost_price: number;
  selling_price: number;
  wholesale_price: number;
  reorder_level: number;
  is_active: number;
}

export interface UnitConversion {
  id: string;
  item_id: string;
  from_unit: string;
  to_unit: string;
  multiplier: number;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  current_balance: number;
  is_active: number;
}

export interface SupplierLedgerEntry {
  id: string;
  supplier_id: string;
  date: string;
  type: 'CHARGE' | 'PAYMENT';
  amount: number;
  reference_id: string | null;
  description: string | null;
  hmac_signature: string | null;
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
  quantity: number;
  unit_price: number;
  total_cost: number;
}

export interface GoodsReceipt {
  id: string;
  purchase_order_id: string;
  date: string;
  received_by: string;
}
