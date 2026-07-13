export interface User {
  id: string;
  username: string;
  name: string;
  role: 'Cashier' | 'Manager' | 'Admin';
  passcode_hash: string;
  passcode_salt: string;
  is_active: number;
  is_system: number;
}

export interface LoginAttempt {
  id: string;
  attempt_type: 'PIN' | 'DOP' | 'MMP';
  username: string;
  ip_address: string;
  timestamp: number;
  is_successful: number;
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
