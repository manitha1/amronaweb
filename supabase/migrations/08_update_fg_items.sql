-- Migration 08: Update fg_items table
-- 1. Add batch_code column
-- 2. Make uom column optional since it's being removed from UI

ALTER TABLE fg_items ADD COLUMN IF NOT EXISTS batch_code TEXT;
ALTER TABLE fg_items ALTER COLUMN uom DROP NOT NULL;

-- Also ensure 'code' column exists if it was missing from earlier migrations
ALTER TABLE fg_items ADD COLUMN IF NOT EXISTS code INTEGER;
ALTER TABLE raw_items ADD COLUMN IF NOT EXISTS code INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS code INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS code INTEGER;
