CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, csrf TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolios (
 owner TEXT PRIMARY KEY REFERENCES sessions(id), revision INTEGER NOT NULL DEFAULT 0,
 book TEXT NOT NULL CHECK(json_valid(book)), updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts (
 owner TEXT NOT NULL REFERENCES sessions(id), key TEXT NOT NULL, request_hash TEXT NOT NULL,
 response TEXT NOT NULL CHECK(json_valid(response)), created_at INTEGER NOT NULL,
 PRIMARY KEY(owner,key)
);
CREATE TABLE IF NOT EXISTS chain_positions (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id),
 state TEXT NOT NULL CHECK(json_valid(state)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chain_positions_owner_created ON chain_positions(owner,created_at DESC);
CREATE TABLE IF NOT EXISTS chain_operations (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id), key TEXT NOT NULL,
 request_hash TEXT NOT NULL, position_id TEXT NOT NULL REFERENCES chain_positions(id),
 action TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('prepared','submitted','confirmed','failed')),
 signature TEXT, raw_transaction TEXT, last_valid_height INTEGER, error TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(owner,key)
);
CREATE INDEX IF NOT EXISTS idx_chain_operations_position ON chain_operations(position_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chain_operations_pending ON chain_operations(position_id) WHERE status IN ('prepared','submitted');
CREATE TABLE IF NOT EXISTS audit_events (
 id INTEGER PRIMARY KEY, owner TEXT, category TEXT NOT NULL, detail TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,unixepoch()*1000);
