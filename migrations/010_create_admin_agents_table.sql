-- Migration 010: Create admin_agents table
-- This table stores the serialized w3up-client agent data for each admin,
-- allowing for persistent, isolated client sessions for each user.

CREATE TABLE IF NOT EXISTS admin_agents (
    adminEmail TEXT PRIMARY KEY,
    agentData TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_agents_email ON admin_agents(adminEmail); 