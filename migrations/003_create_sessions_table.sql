-- Create sessions table
CREATE TABLE IF NOT EXISTS sessions (
    sessionId TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    adminDid TEXT,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email);

-- Create index on expiresAt for faster cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);

-- Create view for active sessions
CREATE VIEW IF NOT EXISTS active_sessions AS
SELECT * FROM sessions WHERE expiresAt > unixepoch() * 1000; 