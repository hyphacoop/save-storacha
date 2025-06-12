-- Migration 006: Add admin tracking to delegations for multi-admin support
-- This migration adds the createdBy field to track which admin created each delegation

-- Add createdBy column to delegations table
ALTER TABLE delegations ADD COLUMN createdBy TEXT;

-- Add index for faster lookups by admin
CREATE INDEX IF NOT EXISTS idx_delegations_createdBy ON delegations(createdBy);

-- Add composite index for admin + space lookups
CREATE INDEX IF NOT EXISTS idx_delegations_createdBy_spaceDid ON delegations(createdBy, spaceDid);

-- Update existing delegations to have a default admin (if any exist)
-- This is a safety measure for existing data
UPDATE delegations SET createdBy = 'legacy-admin' WHERE createdBy IS NULL; 