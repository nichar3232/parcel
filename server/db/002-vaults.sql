CREATE TABLE IF NOT EXISTS vault_accounts (
 owner TEXT PRIMARY KEY REFERENCES sessions(id), revision INTEGER NOT NULL DEFAULT 0,
 book TEXT NOT NULL CHECK(json_valid(book)), updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vault_quotes (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES sessions(id),
 state TEXT NOT NULL CHECK(json_valid(state)), expires_at INTEGER NOT NULL,
 consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_vault_quotes_owner ON vault_quotes(owner,expires_at);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,unixepoch()*1000);
