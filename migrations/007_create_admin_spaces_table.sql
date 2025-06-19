-- Migration 007: Create admin_spaces table for proper space isolation
-- This migration adds a table to track which spaces belong to which admins
-- This fixes the security vulnerability where all admins could see all spaces

-- Create admin_spaces table
CREATE TABLE IF NOT EXISTS admin_spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adminEmail TEXT NOT NULL,
    spaceDid TEXT NOT NULL,
    spaceName TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    UNIQUE(adminEmail, spaceDid)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_spaces_adminEmail ON admin_spaces(adminEmail);
CREATE INDEX IF NOT EXISTS idx_admin_spaces_spaceDid ON admin_spaces(spaceDid);
CREATE INDEX IF NOT EXISTS idx_admin_spaces_createdAt ON admin_spaces(createdAt);

-- Create view for active admin spaces
CREATE VIEW IF NOT EXISTS active_admin_spaces AS
SELECT * FROM admin_spaces 
ORDER BY createdAt DESC; 