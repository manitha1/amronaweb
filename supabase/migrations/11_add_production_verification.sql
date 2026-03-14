-- Migration: Add is_verified column to production_headers
ALTER TABLE production_headers ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
