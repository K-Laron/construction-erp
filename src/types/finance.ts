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
