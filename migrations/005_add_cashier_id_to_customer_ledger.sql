-- Add cashier_id to track which user received the collection

ALTER TABLE customer_ledger ADD COLUMN cashier_id TEXT;
