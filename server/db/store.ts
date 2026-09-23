import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChainPosition, SessionPortfolio } from '../../lib/contracts/api';
import { initialBook, type Book } from '../../lib/engine';
import { ApiError } from '../http/errors';
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export type Session = { id: string; csrf: string; expires_at: number };
export interface AgentKey {
  id: string;
  /** The key's last four characters, so its owner can tell keys apart. */
  hint: string;
  createdAt: number;
  lastUsedAt: number | null;
}
export interface Operation {
  id: string;
  owner: string;
  key: string;
  request_hash: string;
  position_id: string;
  action: string;
  status: 'prepared' | 'submitted' | 'confirmed' | 'failed';
  signature: string | null;
  raw_transaction: string | null;
  last_valid_height: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}
export class Store {
  readonly db: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:')
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') chmodSync(file, 0o600);
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;',
    );
    this.db.exec(
      readFileSync(new URL('./001-initial.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('./002-vaults.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('./003-vault-chain.sql', import.meta.url), 'utf8'),
    );
    this.db.exec(
      readFileSync(new URL('./004-agent-keys.sql', import.meta.url), 'utf8'),
    );
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  session(token: string | undefined, now = Date.now()): Session | undefined {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
    return this.db
      .prepare(
        'SELECT id,csrf,expires_at FROM sessions WHERE token_hash=? AND expires_at>?',
      )
      .get(digest(token), now) as Session | undefined;
  }
  /** The session an agent key acts for, if the key is live and so is the
   * session. Using a key records when it was last used. */
  agentSession(key: string | undefined, now = Date.now()): Session | undefined {
    if (!key || !/^pk_agent_[a-f0-9]{64}$/.test(key)) return;
    const row = this.db
      .prepare(
        'SELECT s.id,s.csrf,s.expires_at,k.id AS key_id FROM agent_keys k JOIN sessions s ON s.id=k.owner WHERE k.key_hash=? AND k.revoked_at IS NULL AND s.expires_at>?',
      )
      .get(digest(key), now) as (Session & { key_id: string }) | undefined;
    if (!row) return;
    this.db
      .prepare('UPDATE agent_keys SET last_used_at=? WHERE id=?')
      .run(now, row.key_id);
    return { id: row.id, csrf: row.csrf, expires_at: row.expires_at };
  }
  agentKeys(owner: string): AgentKey[] {
    return this.db
      .prepare(
        'SELECT id,hint,created_at AS createdAt,last_used_at AS lastUsedAt FROM agent_keys WHERE owner=? AND revoked_at IS NULL ORDER BY created_at DESC',
      )
      .all(owner) as unknown as AgentKey[];
  }
  createAgentKey(owner: string, now = Date.now()) {
    return this.transaction(() => {
      if (this.agentKeys(owner).length >= 5)
        throw new ApiError(
          409,
          'AGENT_KEY_LIMIT',
          'This vault already has five agent keys. Revoke one first.',
        );
      const key = `pk_agent_${randomBytes(32).toString('hex')}`,
        id = randomUUID(),
        hint = key.slice(-4);
      this.db
        .prepare(
          'INSERT INTO agent_keys(id,owner,key_hash,hint,created_at) VALUES(?,?,?,?,?)',
        )
        .run(id, owner, digest(key), hint, now);
      return { key, agentKey: { id, hint, createdAt: now, lastUsedAt: null } };
    });
  }
  revokeAgentKey(owner: string, id: string, now = Date.now()) {
    const r = this.db
      .prepare(
        'UPDATE agent_keys SET revoked_at=? WHERE id=? AND owner=? AND revoked_at IS NULL',
      )
      .run(now, id, owner);
    if (!r.changes)
      throw new ApiError(404, 'AGENT_KEY', 'That agent key was not found.');
  }
  createSession(now = Date.now()) {
    const token = randomBytes(32).toString('hex'),
      s = {
        id: randomUUID(),
        csrf: randomBytes(24).toString('hex'),
        expires_at: now + 30 * 86400_000,
      };
    this.transaction(() => {
      this.db
        .prepare('INSERT INTO sessions VALUES(?,?,?,?,?)')
        .run(s.id, digest(token), s.csrf, now, s.expires_at);
      this.db
        .prepare('INSERT INTO portfolios VALUES(?,0,?,?)')
        .run(s.id, JSON.stringify(initialBook()), now);
    });
    return { token, session: s };
  }
  portfolio(s: Session): SessionPortfolio {
    const row = this.db
      .prepare('SELECT revision,book FROM portfolios WHERE owner=?')
      .get(s.id) as { revision: number; book: string } | undefined;
    if (!row)
      throw new ApiError(404, 'NO_PORTFOLIO', 'The portfolio was not found.');
    return {
      book: JSON.parse(row.book) as Book,
      revision: row.revision,
      csrf: s.csrf,
      serverTime: Date.now(),
      sessionExpiresAt: s.expires_at,
    };
  }
  receipt(owner: string, key: string, hash: string): unknown {
    const r = this.db
      .prepare(
        'SELECT request_hash,response FROM receipts WHERE owner=? AND key=?',
      )
      .get(owner, key) as
      | { request_hash: string; response: string }
      | undefined;
    if (r && r.request_hash !== hash)
      throw new ApiError(
        409,
        'IDEMPOTENCY_MISMATCH',
        'This request identifier already belongs to different terms.',
      );
    return r ? JSON.parse(r.response) : undefined;
  }
  saveReceipt(owner: string, key: string, hash: string, value: unknown) {
    this.db
      .prepare('INSERT INTO receipts VALUES(?,?,?,?,?)')
      .run(owner, key, hash, JSON.stringify(value), Date.now());
  }
  saveBook(owner: string, book: Book, revision: number) {
    this.db
      .prepare(
        'UPDATE portfolios SET book=?,revision=?,updated_at=? WHERE owner=?',
      )
      .run(JSON.stringify(book), revision, Date.now(), owner);
  }
  audit(owner: string, category: string, detail: string) {
    this.db
      .prepare(
        'INSERT INTO audit_events(owner,category,detail,created_at) VALUES(?,?,?,?)',
      )
      .run(owner, category, detail, Date.now());
  }
  position(owner: string, id: string): ChainPosition {
    const r = this.db
      .prepare('SELECT state FROM chain_positions WHERE id=? AND owner=?')
      .get(id, owner) as { state: string } | undefined;
    if (!r)
      throw new ApiError(
        404,
        'POSITION_NOT_FOUND',
        'This contract was not found in your session.',
      );
    return JSON.parse(r.state) as ChainPosition;
  }
  positions(owner: string): ChainPosition[] {
    return (
      this.db
        .prepare(
          'SELECT state FROM chain_positions WHERE owner=? ORDER BY created_at DESC',
        )
        .all(owner) as { state: string }[]
    ).map((r) => JSON.parse(r.state) as ChainPosition);
  }
  savePosition(owner: string, position: ChainPosition) {
    this.db
      .prepare(
        'INSERT INTO chain_positions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at WHERE chain_positions.owner=excluded.owner',
      )
      .run(
        position.id,
        owner,
        JSON.stringify(position),
        Date.now(),
        Date.now(),
      );
  }
  operation(owner: string, key: string, hash?: string) {
    const row = this.db
      .prepare('SELECT * FROM chain_operations WHERE owner=? AND key=?')
      .get(owner, key) as Operation | undefined;
    if (row && hash && row.request_hash !== hash)
      throw new ApiError(
        409,
        'IDEMPOTENCY_MISMATCH',
        'This request identifier already belongs to different terms.',
      );
    return row;
  }
  operations(owner: string, id: string) {
    this.position(owner, id);
    return this.db
      .prepare(
        'SELECT * FROM chain_operations WHERE owner=? AND position_id=? ORDER BY created_at',
      )
      .all(owner, id) as unknown as Operation[];
  }
  pending(owner: string, id: string) {
    return this.db
      .prepare(
        "SELECT * FROM chain_operations WHERE owner=? AND position_id=? AND status IN ('prepared','submitted')",
      )
      .get(owner, id) as Operation | undefined;
  }
  insertOperation(op: Operation) {
    this.db
      .prepare('INSERT INTO chain_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        op.id,
        op.owner,
        op.key,
        op.request_hash,
        op.position_id,
        op.action,
        op.status,
        op.signature,
        op.raw_transaction,
        op.last_valid_height,
        op.error,
        op.created_at,
        op.updated_at,
      );
  }
  updateOperation(
    id: string,
    status: Operation['status'],
    error: string | null = null,
  ) {
    this.db
      .prepare(
        'UPDATE chain_operations SET status=?,error=?,updated_at=? WHERE id=?',
      )
      .run(status, error, Date.now(), id);
  }
  close() {
    this.db.close();
  }
}
