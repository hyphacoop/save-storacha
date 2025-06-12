-- Create table for tracking account sessions
CREATE TABLE IF NOT EXISTS account_sessions (
    sessionId TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    did TEXT,
    createdAt INTEGER NOT NULL,
    lastActiveAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    userAgent TEXT,
    ipAddress TEXT,
    isActive BOOLEAN DEFAULT true,
    FOREIGN KEY (did) REFERENCES did_email_mapping(did) ON DELETE SET NULL
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_account_sessions_email ON account_sessions(email);
CREATE INDEX IF NOT EXISTS idx_account_sessions_did ON account_sessions(did);
CREATE INDEX IF NOT EXISTS idx_account_sessions_active ON account_sessions(isActive, expiresAt);

-- Create view for active sessions
CREATE VIEW IF NOT EXISTS active_account_sessions AS
SELECT * FROM account_sessions 
WHERE isActive = true AND expiresAt > unixepoch() * 1000; 