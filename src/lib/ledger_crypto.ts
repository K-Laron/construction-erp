import crypto from 'crypto';

// Calculate the HMAC signature for a ledger entry
export function calculateHMACSignature(
  entry: { id: string; customer_id?: string; supplier_id?: string; amount: number; type: string; date?: string }, 
  prevSig: string,
  mlekSecret: Buffer
): string {
  const entityId = entry.customer_id || entry.supplier_id || '';
  const dateStr = entry.date || '';
  const data = `${entry.id}-${entityId}-${entry.amount}-${entry.type}-${dateStr}-${prevSig}`;
  return crypto.createHmac('sha256', mlekSecret).update(data).digest('hex');
}
