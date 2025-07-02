-- Step 1: Rename the old table
ALTER TABLE account_sessions RENAME TO _account_sessions_old;

-- Step 2: Create the new table without the foreign key constraint
CREATE TABLE account_sessions (
    sessionId TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    did TEXT,
    createdAt INTEGER NOT NULL,
    lastActiveAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    userAgent TEXT,
    ipAddress TEXT,
    isActive BOOLEAN DEFAULT true,
    isVerified INTEGER DEFAULT 0 -- Retain the verification status column
);

-- Step 3: Copy the data from the old table to the new one
INSERT INTO account_sessions (sessionId, email, did, createdAt, lastActiveAt, expiresAt, userAgent, ipAddress, isActive, isVerified)
SELECT sessionId, email, did, createdAt, lastActiveAt, expiresAt, userAgent, ipAddress, isActive, isVerified
FROM _account_sessions_old;

-- Step 4: Drop the old table
DROP TABLE _account_sessions_old;

-- Step 5: Recreate indexes on the new table
CREATE INDEX IF NOT EXISTS idx_account_sessions_email ON account_sessions(email);
CREATE INDEX IF NOT EXISTS idx_account_sessions_did ON account_sessions(did);
CREATE INDEX IF NOT EXISTS idx_account_sessions_active ON account_sessions(isActive, expiresAt); 