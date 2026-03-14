-- Migration: Add is_verified column to production_lines
ALTER TABLE production_lines ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
