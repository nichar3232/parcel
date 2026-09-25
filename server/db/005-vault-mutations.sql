-- Durable, queryable record of every committed vault mutation.
-- Activity in the book JSON remains the human-readable feed; this table
-- is the index for recovery, audits and premium/revision checks.
-- System rows (live settlement on read) use key prefix "system:".
CREATE TABLE IF NOT EXISTS vault_mutations (
 owner TEXT NOT NULL REFERENCES sessions(id),
 key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 revision_before INTEGER NOT NULL,
 revision_after INTEGER NOT NULL,
 action_type TEXT NOT NULL,
 detail TEXT NOT NULL CHECK(json_valid(detail)),
 quote_id TEXT,
 premium REAL,
 mode TEXT NOT NULL CHECK(mode IN ('sandbox','localnet','devnet','system')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(owner, key)
);
CREATE INDEX IF NOT EXISTS idx_vault_mutations_owner_created
 ON vault_mutations(owner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_mutations_owner_revision
 ON vault_mutations(owner, revision_after);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,unixepoch()*1000);
