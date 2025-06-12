-- Create user_principals table
CREATE TABLE IF NOT EXISTS user_principals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userDid TEXT NOT NULL UNIQUE,
    principalDid TEXT NOT NULL,
    principalKey TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_principals_userDid ON user_principals(userDid);
CREATE INDEX IF NOT EXISTS idx_user_principals_principalDid ON user_principals(principalDid);
CREATE INDEX IF NOT EXISTS idx_user_principals_createdAt ON user_principals(createdAt);

-- Create delegations table
CREATE TABLE IF NOT EXISTS delegations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userDid TEXT NOT NULL,
    spaceDid TEXT NOT NULL,
    delegationCid TEXT NOT NULL,
    delegationCar TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    UNIQUE(userDid, spaceDid)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_delegations_userDid ON delegations(userDid);
CREATE INDEX IF NOT EXISTS idx_delegations_spaceDid ON delegations(spaceDid);
CREATE INDEX IF NOT EXISTS idx_delegations_createdAt ON delegations(createdAt);
CREATE INDEX IF NOT EXISTS idx_delegations_updatedAt ON delegations(updatedAt); 