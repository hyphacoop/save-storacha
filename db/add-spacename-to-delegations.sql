-- Migration: Add spaceName column to delegations table
-- This migration adds support for storing space names in delegation records
-- so that delegated users can see meaningful space names instead of just DIDs.

-- Check if the spaceName column already exists before adding it
-- SQLite doesn't have IF NOT EXISTS for ALTER TABLE ADD COLUMN, so we use a PRAGMA check

-- Add the spaceName column to the delegations table
ALTER TABLE delegations ADD COLUMN spaceName TEXT;

-- Note: For existing delegations without space names, the space listing logic
-- will fall back to using the spaceDid as the display name until space names
-- can be resolved from other sources (admin_spaces table) or during next delegation creation.