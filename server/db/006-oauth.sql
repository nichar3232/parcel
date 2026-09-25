-- Claude and other MCP apps connect through OAuth: they register themselves,
-- the owner approves on Parcel's page, and the app trades a one-time code
-- (bound to a PKCE challenge) for an agent key. Codes are stored hashed and
-- live for a minute.
CREATE TABLE IF NOT EXISTS oauth_clients (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 redirect_uris TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
 code_hash TEXT PRIMARY KEY,
 client_id TEXT NOT NULL REFERENCES oauth_clients(id),
 owner TEXT NOT NULL REFERENCES sessions(id),
 redirect_uri TEXT NOT NULL,
 challenge TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER
);
