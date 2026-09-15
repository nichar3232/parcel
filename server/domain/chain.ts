import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import type { ChainAction, ChainPosition } from '../../lib/contracts/api';
import { Store, digest, type Operation, type Session } from '../db/store';
import { ApiError, friendlyChainError, object } from '../http/errors';
import type { ChainAdapter } from '../solana/adapter';
import { parseKey, parseTerms } from './portfolio';
export class ChainService {
  private locks = new Set<string>();
  constructor(
    private store: Store,
    readonly adapter: ChainAdapter,
    private stateDir: string,
  ) {}
  async action(
    session: Session,
    key: string,
    value: unknown,
  ): Promise<ChainPosition> {
    parseKey(key);
    const input = object(value),
      action = input.action as ChainAction;
    if (
      ![
        'fund',
        'accept',
        'cancel',
        'settle',
        'claim-holder',
        'claim-maker',
      ].includes(action)
    )
      throw new ApiError(400, 'UNKNOWN_ACTION', 'Unsupported chain action.');
    if ('missing' in input && typeof input.missing !== 'boolean')
      throw new ApiError(
        400,
        'INVALID_OBSERVATION',
        'Observation availability must be boolean.',
      );
    if (action === 'fund') input.terms = parseTerms(input.terms);
    const hash = digest(JSON.stringify(input));
    if (this.locks.has(session.id))
      throw new ApiError(
        409,
        'CHAIN_BUSY',
        'A chain request for this session is still being prepared. Refresh before retrying.',
      );
    this.locks.add(session.id);
    try {
      const existing = this.store.operation(session.id, key, hash);
      if (existing) return this.resume(existing);
      let position: ChainPosition | undefined;
      if (action !== 'fund') {
        if (typeof input.id !== 'string')
          throw new ApiError(400, 'POSITION_REQUIRED', 'Choose a contract.');
        position = this.store.position(session.id, input.id);
        const pending = this.store.pending(session.id, position.id);
        if (pending)
          return {
            ...(await this.resume(pending)),
            warning:
              'The preceding transaction must resolve before another action.',
          };
      } else {
        const recent = this.store.positions(session.id);
        if (recent.length >= 100)
          throw new ApiError(
            429,
            'CHAIN_LIMIT',
            'This demo session has reached its 100-contract limit.',
          );
        if (
          recent.some(
            (p) =>
              Date.now() - Date.parse(p.updatedAt) < 15000 &&
              p.status === 'prepared',
          )
        )
          throw new ApiError(
            429,
            'CHAIN_LIMIT',
            'Wait for the preceding funded offer to confirm.',
          );
      }
      const prepared = await this.adapter.prepare(
        session.id,
        action,
        position,
        input,
      );
      const op: Operation = {
        id: randomUUID(),
        owner: session.id,
        key,
        request_hash: hash,
        position_id: prepared.position.id,
        action,
        status: 'prepared',
        signature: prepared.signature,
        raw_transaction: prepared.raw,
        last_valid_height: prepared.lastValidHeight,
        error: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      this.store.transaction(() => {
        if (this.store.operation(session.id, key, hash))
          throw new ApiError(
            409,
            'CHAIN_BUSY',
            'The same request is being prepared elsewhere. Retry with the same key.',
          );
        this.store.savePosition(session.id, {
          ...prepared.position,
          pending: true,
          operationId: op.id,
        });
        this.store.insertOperation(op);
        this.store.audit(
          session.id,
          'chain-prepared',
          JSON.stringify({ id: op.id, action, signature: op.signature }),
        );
      });
      return this.resume(op);
    } finally {
      this.locks.delete(session.id);
    }
  }
  async resume(op: Operation): Promise<ChainPosition> {
    let p = this.store.position(op.owner, op.position_id);
    if (op.status === 'failed')
      return {
        ...p,
        pending: false,
        warning:
          op.error ||
          'The transaction failed. Review state before a new request.',
      };
    if (op.status === 'confirmed') return this.refresh(op.owner, p);
    try {
      let state = await this.adapter.confirmation(
        op.signature!,
        op.last_valid_height!,
      );
      if (state === 'pending') {
        // A retry broadcasts exactly the same signed bytes; it can never create another transfer.
        try {
          await this.adapter.broadcast(op.raw_transaction!);
          this.store.updateOperation(op.id, 'submitted');
        } catch {
          /* An RPC error cannot prove that a previous broadcast did not land. */
        }
        if (state === 'pending')
          state = await this.adapter.confirmation(
            op.signature!,
            op.last_valid_height!,
          );
      }
      if (state === 'expired' || typeof state === 'object') {
        const error =
          state === 'expired'
            ? 'The transaction expired without landing. A new request is safe.'
            : friendlyChainError(new Error(state.error));
        this.store.updateOperation(op.id, 'failed', error);
        p = { ...p, pending: false, warning: error };
        this.store.savePosition(op.owner, p);
        return p;
      }
      if (state === 'confirmed') {
        this.store.transaction(() => {
          this.store.updateOperation(op.id, 'confirmed');
          p = this.store.position(op.owner, p.id);
          if (!p.transactions.some((t) => t.signature === op.signature))
            p.transactions.push({
              label: op.action,
              signature: op.signature!,
              status: 'confirmed',
            });
          p = { ...p, pending: false, warning: undefined };
          this.store.savePosition(op.owner, p);
        });
        // Proof archival is optional evidence, never part of monetary transaction success.
        try {
          const proof = await this.adapter.proof(op.signature!);
          const dir = `${this.stateDir}/proofs`;
          await mkdir(dir, { recursive: true, mode: 0o700 });
          const file = `${dir}/${op.signature}.json`,
            tmp = `${file}.${randomUUID()}.tmp`;
          await writeFile(tmp, JSON.stringify(proof), { mode: 0o600 });
          await rename(tmp, file);
        } catch {
          /* RPC or disk evidence failure leaves the durable signature intact. */
        }
        return this.refresh(op.owner, p);
      }
      return {
        ...p,
        pending: true,
        warning:
          'Confirmation is pending. Refresh safely; the same signed transaction will be checked.',
      };
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) throw e;
      return {
        ...p,
        pending: true,
        warning:
          'The chain is temporarily unavailable. Your signed request is saved; refresh to reconcile it.',
      };
    }
  }
  private async refresh(owner: string, p: ChainPosition) {
    try {
      const observation = await this.adapter.read(p);
      return this.store.transaction(() => {
        const latest = this.store.position(owner, p.id);
        if (observation.lastSlot < latest.lastSlot) return latest;
        const result = {
          ...observation,
          transactions: latest.transactions,
          operationId: latest.operationId,
          pending: !!this.store.pending(owner, p.id),
        };
        this.store.savePosition(owner, result);
        return result;
      });
    } catch {
      return {
        ...p,
        warning:
          'The latest chain state is unavailable. Showing the last confirmed state.',
      };
    }
  }
  async read(session: Session, id: string) {
    const p = this.store.position(session.id, id),
      pending = this.store.pending(session.id, id);
    return pending
      ? this.resume(pending)
      : p.status === 'prepared'
        ? p
        : this.refresh(session.id, p);
  }
  list(session: Session) {
    return this.store.positions(session.id);
  }
}
