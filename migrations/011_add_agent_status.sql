-- Add status to admin_agents to track onboarding state
ALTER TABLE admin_agents ADD COLUMN status TEXT CHECK(status IN ('pending', 'active', 'failed')) NOT NULL DEFAULT 'pending';

-- We can also add an index on status for faster lookups
CREATE INDEX idx_admin_agents_status ON admin_agents (status);

-- We might want to backfill existing agents to 'active' if this were a live system
-- For our case, we'll start with fresh data, so this is not strictly necessary.
-- UPDATE admin_agents SET status = 'active' WHERE status = 'pending'; 