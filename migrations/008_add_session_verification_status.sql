-- Add a new column to track if the session has been fully verified
-- via the background email/w3up process.
-- Defaults to 0 (false) for new sessions.
ALTER TABLE account_sessions
ADD COLUMN isVerified INTEGER DEFAULT 0; 