-- Consolidated Schema for the Application

-- This single schema file replaces the multiple migration files.
-- It represents the final, up-to-date structure of the database,
-- making it easier to manage, version, and understand.

-- =============================================================================
-- Table: user_principals
-- Stores cryptographic identities for users.
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_principals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userDid TEXT NOT NULL UNIQUE,
    principalDid TEXT NOT NULL,
    principalKey TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_principals_userDid ON user_principals(userDid);
CREATE INDEX IF NOT EXISTS idx_user_principals_principalDid ON user_principals(principalDid);
CREATE INDEX IF NOT EXISTS idx_user_principals_createdAt ON user_principals(createdAt);


-- =============================================================================
-- Table: delegations
-- Manages access grants (delegations) between users and spaces.
-- =============================================================================
CREATE TABLE IF NOT EXISTS delegations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userDid TEXT NOT NULL,
    spaceDid TEXT NOT NULL,
    spaceName TEXT,
    delegationCid TEXT NOT NULL,
    delegationCar TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    expiresAt INTEGER,
    createdBy TEXT,
    UNIQUE(userDid, spaceDid)
);

CREATE INDEX IF NOT EXISTS idx_delegations_userDid ON delegations(userDid);
CREATE INDEX IF NOT EXISTS idx_delegations_spaceDid ON delegations(spaceDid);
CREATE INDEX IF NOT EXISTS idx_delegations_createdAt ON delegations(createdAt);
CREATE INDEX IF NOT EXISTS idx_delegations_updatedAt ON delegations(updatedAt);
CREATE INDEX IF NOT EXISTS idx_delegations_expiresAt ON delegations(expiresAt);
CREATE INDEX IF NOT EXISTS idx_delegations_createdBy ON delegations(createdBy);
CREATE INDEX IF NOT EXISTS idx_delegations_createdBy_spaceDid ON delegations(createdBy, spaceDid);


-- =============================================================================
-- Table: did_email_mapping
-- Maps user DIDs to their email addresses for identification.
-- Supports multiple DIDs per email (multiple devices per admin).
-- =============================================================================
CREATE TABLE IF NOT EXISTS did_email_mapping (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    did TEXT NOT NULL,
    email TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    UNIQUE(email, did)
);

CREATE INDEX IF NOT EXISTS idx_did_email_mapping_email ON did_email_mapping(email);
CREATE INDEX IF NOT EXISTS idx_did_email_mapping_did ON did_email_mapping(did);


-- =============================================================================
-- Table: account_sessions
-- Tracks admin user sessions and their verification status.
-- =============================================================================
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
    isVerified INTEGER DEFAULT 0,
    emailVerified INTEGER DEFAULT 0,
    didVerified INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_account_sessions_email ON account_sessions(email);
CREATE INDEX IF NOT EXISTS idx_account_sessions_did ON account_sessions(did);
CREATE INDEX IF NOT EXISTS idx_account_sessions_active ON account_sessions(isActive, expiresAt);


-- =============================================================================
-- Table: admin_spaces
-- Associates admin accounts with the spaces they manage.
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_spaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adminEmail TEXT NOT NULL,
    spaceDid TEXT NOT NULL,
    spaceName TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    UNIQUE(adminEmail, spaceDid)
);

CREATE INDEX IF NOT EXISTS idx_admin_spaces_adminEmail ON admin_spaces(adminEmail);
CREATE INDEX IF NOT EXISTS idx_admin_spaces_spaceDid ON admin_spaces(spaceDid);
CREATE INDEX IF NOT EXISTS idx_admin_spaces_createdAt ON admin_spaces(createdAt);


-- =============================================================================
-- Table: admin_agents
-- Stores serialized w3up-client agent data for each admin.
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_agents (
    adminEmail TEXT PRIMARY KEY,
    agentData TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    status TEXT CHECK(status IN ('pending', 'active', 'failed')) NOT NULL DEFAULT 'pending',
    planProduct TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_agents_email ON admin_agents(adminEmail);
CREATE INDEX IF NOT EXISTS idx_admin_agents_status ON admin_agents (status);
CREATE INDEX IF NOT EXISTS idx_admin_agents_planProduct ON admin_agents(planProduct);


-- =============================================================================
-- Table: auth_challenges
-- Stores cryptographic challenges for DID-based authentication.
-- =============================================================================
CREATE TABLE IF NOT EXISTS auth_challenges (
    challengeId TEXT PRIMARY KEY,
    did TEXT NOT NULL,
    challenge TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    used INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_did ON auth_challenges(did);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expiresAt);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_used ON auth_challenges(used);


-- =============================================================================
-- Views
-- Provide convenient, pre-defined queries for common data access patterns.
-- =============================================================================

-- View: active_delegations
-- Shows delegations that have not yet expired.
CREATE VIEW IF NOT EXISTS active_delegations AS
SELECT * FROM delegations
WHERE expiresAt IS NULL OR expiresAt > unixepoch() * 1000;

-- View: active_account_sessions
-- Shows user sessions that are currently active and have not expired.
CREATE VIEW IF NOT EXISTS active_account_sessions AS
SELECT * FROM account_sessions
WHERE isActive = true AND expiresAt > unixepoch() * 1000;

-- View: active_admin_spaces
-- A simple view to order admin spaces by creation date.
CREATE VIEW IF NOT EXISTS active_admin_spaces AS
SELECT * FROM admin_spaces
ORDER BY createdAt DESC;

-- Note: The `sessions` table from migration 003 was superseded by
-- `account_sessions` in migration 005 and later adjusted in 009,
-- so it is not included in the final schema. 