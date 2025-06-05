-- Create table for mapping DIDs to emails
CREATE TABLE IF NOT EXISTS did_email_mapping (
    did TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    createdAt INTEGER NOT NULL
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_did_email_mapping_email ON did_email_mapping(email); 