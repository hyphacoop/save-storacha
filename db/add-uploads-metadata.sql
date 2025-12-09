-- Migration: Add uploads_metadata table for tracking original filenames
-- 
-- This table stores metadata about files uploaded through our service,
-- allowing us to associate original filenames with IPFS CIDs.
-- 
-- Note: We can only track filenames for uploads made through our API.
-- External uploads to the same Storacha space won't have filename metadata.

CREATE TABLE IF NOT EXISTS uploads_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cid TEXT NOT NULL,
    filename TEXT NOT NULL,
    uploadedBy TEXT NOT NULL,  -- user DID who uploaded the file
    spaceDid TEXT NOT NULL,    -- space where file was uploaded
    uploadedAt INTEGER NOT NULL,  -- Unix timestamp in milliseconds
    size INTEGER,              -- File size in bytes
    contentType TEXT,          -- MIME type if known
    UNIQUE(cid, spaceDid)      -- Same CID can exist in multiple spaces
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_uploads_metadata_cid ON uploads_metadata(cid);
CREATE INDEX IF NOT EXISTS idx_uploads_metadata_spaceDid ON uploads_metadata(spaceDid);
CREATE INDEX IF NOT EXISTS idx_uploads_metadata_filename ON uploads_metadata(filename);
CREATE INDEX IF NOT EXISTS idx_uploads_metadata_uploadedBy ON uploads_metadata(uploadedBy);
CREATE INDEX IF NOT EXISTS idx_uploads_metadata_uploadedAt ON uploads_metadata(uploadedAt);
CREATE INDEX IF NOT EXISTS idx_uploads_metadata_spaceDid_uploadedAt ON uploads_metadata(spaceDid, uploadedAt);




