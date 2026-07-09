import crypto from 'crypto';
import { CustomerLedgerEntry } from '@/types';

// Calculate the HMAC signature for a ledger entry
export function calculateHMACSignature(
  entry: Omit<CustomerLedgerEntry, 'hmac_signature'>, 
  prevSig: string,
  mlekSecret: Buffer
): string {
  const data = `${entry.id}-${entry.customer_id}-${entry.amount}-${entry.type}-${prevSig}`;
  return crypto.createHmac('sha256', mlekSecret).update(data).digest('hex');
}
