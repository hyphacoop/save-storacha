-- Add expiry column to delegations table
ALTER TABLE delegations ADD COLUMN expiresAt INTEGER;

-- Create index for expiry to speed up cleanup queries
CREATE INDEX IF NOT EXISTS idx_delegations_expiresAt ON delegations(expiresAt);

-- Create a view for active delegations (not expired)
CREATE VIEW IF NOT EXISTS active_delegations AS
SELECT * FROM delegations 
WHERE expiresAt IS NULL OR expiresAt > unixepoch() * 1000; 