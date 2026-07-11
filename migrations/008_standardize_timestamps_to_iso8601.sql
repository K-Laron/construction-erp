-- Update all existing timestamps in the database to standardized ISO-8601 format
-- so that lexicographical comparisons and queries (ORDER BY and range checks) work correctly.

UPDATE transactions SET date = strftime('%Y-%m-%dT%H:%M:%fZ', date) WHERE date NOT LIKE '%T%';

UPDATE shifts SET opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', opened_at) WHERE opened_at NOT LIKE '%T%';

UPDATE shifts SET closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', closed_at) WHERE closed_at IS NOT NULL AND closed_at NOT LIKE '%T%';

UPDATE customer_ledger SET date = strftime('%Y-%m-%dT%H:%M:%fZ', date) WHERE date NOT LIKE '%T%';

UPDATE supplier_ledger SET date = strftime('%Y-%m-%dT%H:%M:%fZ', date) WHERE date NOT LIKE '%T%';

UPDATE purchase_orders SET date = strftime('%Y-%m-%dT%H:%M:%fZ', date) WHERE date NOT LIKE '%T%';

UPDATE goods_receipts SET date = strftime('%Y-%m-%dT%H:%M:%fZ', date) WHERE date NOT LIKE '%T%';

UPDATE system_audit_logs SET timestamp = strftime('%Y-%m-%dT%H:%M:%fZ', timestamp) WHERE timestamp NOT LIKE '%T%';
