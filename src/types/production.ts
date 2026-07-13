export interface Worker {
  id: string;
  name: string;
  role: 'Helper' | 'Driver' | 'Block Maker';
  phone: string | null;
  pay_rate: number;
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
  quantity: number;
  earnings: number;
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
