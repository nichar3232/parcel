-- Keys an agent presents as a bearer token to act for one session's vault.
-- Only a hash is stored; the key itself is shown once, when it is created.
CREATE TABLE IF NOT EXISTS agent_keys (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL REFERENCES sessions(id),
 key_hash TEXT NOT NULL UNIQUE,
 hint TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 last_used_at INTEGER,
 revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS agent_keys_owner ON agent_keys(owner);
