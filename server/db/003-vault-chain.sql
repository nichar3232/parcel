CREATE TABLE IF NOT EXISTS vault_chain_operations (
 owner TEXT NOT NULL REFERENCES sessions(id),
 key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 plan TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('preparing','pending','confirmed','failed')),
 stage TEXT NOT NULL CHECK(stage IN ('initialize','execute')),
 transaction_json TEXT,
 proof TEXT,
 error TEXT,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(owner,key)
);
CREATE UNIQUE INDEX IF NOT EXISTS vault_chain_one_pending ON vault_chain_operations(owner) WHERE status IN ('preparing','pending');
