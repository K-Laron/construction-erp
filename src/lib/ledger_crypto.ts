import crypto from 'crypto';

// Calculate the HMAC signature for a ledger entry
export function calculateHMACSignature(
  entry: { 
    id: string; 
    customer_id?: string; 
    supplier_id?: string; 
    amount: number; 
    type: string; 
    date?: string;
    reference_id?: string | null;
    description?: string | null;
    cashier_id?: string | null;
  }, 
  prevSig: string,
  mlekSecret: Buffer
): string {
  const entityId = entry.customer_id || entry.supplier_id || '';
  const dateStr = entry.date || '';
  const refId = entry.reference_id || '';
  const desc = entry.description || '';
  const cashier = entry.cashier_id || '';
  const data = `${entry.id}-${entityId}-${entry.amount}-${entry.type}-${dateStr}-${refId}-${desc}-${cashier}-${prevSig}`;
  return crypto.createHmac('sha256', mlekSecret).update(data).digest('hex');
}
