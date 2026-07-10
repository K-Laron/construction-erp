ALTER TABLE transaction_items ADD COLUMN quantity_returned INTEGER DEFAULT 0 CHECK(quantity_returned >= 0);

ALTER TABLE timecards RENAME COLUMN hours_worked TO minutes_worked;
