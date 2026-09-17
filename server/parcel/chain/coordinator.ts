import { Store, digest, type Session } from '../../db/store';
import { ApiError, object } from '../../http/errors';
import { parseKey } from '../../domain/portfolio';
import { VaultService, type VaultPlan } from '../service';
import type { VaultSnapshot } from '../../../lib/parcel/types';
import type { PreparedVaultTransaction, VaultChainAdapter } from './adapter';
interface Operation {
  owner: string;
  key: string;
  request_hash: string;
  plan: string;
  status: 'preparing' | 'pending' | 'confirmed' | 'failed';
  stage: 'initialize' | 'execute';
  transaction_json: string | null;
  proof: string | null;
  error: string | null;
}
export class VaultChainCoordinator {
  private running = new Map<string, Promise<VaultSnapshot>>();
  constructor(
    private store: Store,
    private vault: VaultService,
    private adapter: VaultChainAdapter,
  ) {}
  private row(owner: string, key: string) {
    return this.store.db
      .prepare('SELECT * FROM vault_chain_operations WHERE owner=? AND key=?')
      .get(owner, key) as unknown as Operation | undefined;
  }
  snapshot(session: Session): VaultSnapshot {
    const proof = this.store.db
      .prepare(
        "SELECT proof FROM vault_chain_operations WHERE owner=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1",
      )
      .get(session.id) as { proof: string } | undefined;
    return {
      ...this.vault.snapshot(session),
      mode: 'localnet',
      chain: proof ? JSON.parse(proof.proof) : undefined,
    };
  }
  apply(session: Session, key: string, value: unknown): Promise<VaultSnapshot> {
    // Keep one session's RPC workflow ordered without locking SQLite across awaits.
    const previous = this.running.get(session.id) || Promise.resolve(undefined);
    const result = previous
      .catch(() => undefined)
      .then(() => this.run(session, key, value));
    this.running.set(session.id, result);
    void result
      .finally(() => {
        if (this.running.get(session.id) === result)
          this.running.delete(session.id);
      })
      .catch(() => {});
    return result;
  }
  private async run(
    session: Session,
    key: string,
    value: unknown,
  ): Promise<VaultSnapshot> {
    parseKey(key);
    const request = object(value),
      hash = digest('vault-action:' + JSON.stringify(request));
    this.store.transaction(() => {
      const cached = this.row(session.id, key);
      if (cached) {
        if (cached.request_hash !== hash)
          throw new ApiError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'This request key was used for different terms.',
          );
        return;
      }
      const pending = this.store.db
        .prepare(
          "SELECT key FROM vault_chain_operations WHERE owner=? AND status IN ('preparing','pending')",
        )
        .get(session.id);
      if (pending)
        throw new ApiError(
          409,
          'VAULT_PENDING',
          'Resolve the original pending action before submitting another.',
        );
      const plan = this.vault.plan(session, value);
      if (
        plan.book.options.filter((p) => p.status === 'active').length +
          plan.book.loans.filter((p) => p.status === 'active').length +
          plan.book.shorts.filter((p) => p.status === 'active').length >
        64
      )
        throw new ApiError(
          409,
          'CHAIN_CAPACITY',
          'The onchain test vault supports 64 active positions. Close or settle existing positions first.',
        );
      this.store.db
        .prepare(
          "INSERT INTO vault_chain_operations(owner,key,request_hash,plan,status,stage,created_at) VALUES(?,?,?,?,'preparing','initialize',?)",
        )
        .run(session.id, key, hash, JSON.stringify(plan), Date.now());
    });
    for (let stage = 0; stage < 3; stage++) {
      let op = this.row(session.id, key)!;
      if (op.status === 'failed')
        throw new ApiError(
          409,
          'CHAIN_FAILED',
          op.error || 'The onchain action failed.',
        );
      if (op.status === 'confirmed') {
        const receipt = this.store.receipt(
          session.id,
          key,
          hash,
        ) as VaultSnapshot;
        return { ...receipt, mode: 'localnet', chain: JSON.parse(op.proof!) };
      }
      const plan = JSON.parse(op.plan) as VaultPlan;
      if (!op.transaction_json) {
        let prepared: PreparedVaultTransaction | null;
        try {
          prepared = await this.adapter.prepare(session.id, plan, op.stage);
        } catch (error) {
          const message = (error as Error).message;
          // A known simulation rejection has no external effect; RPC availability
          // failures leave the original plan recoverable instead of inventing a retry.
          if (
            message.startsWith('Parcel program rejected') ||
            message.startsWith('Onchain mode needs')
          ) {
            this.store.db
              .prepare(
                "UPDATE vault_chain_operations SET status='failed',error=? WHERE owner=? AND key=? AND transaction_json IS NULL",
              )
              .run(message, session.id, key);
            throw new ApiError(409, 'CHAIN_REJECTED', message);
          }
          throw error;
        }
        if (!prepared) {
          this.store.db
            .prepare(
              "UPDATE vault_chain_operations SET stage='execute' WHERE owner=? AND key=? AND stage='initialize' AND transaction_json IS NULL",
            )
            .run(session.id, key);
          continue;
        }
        this.store.db
          .prepare(
            "UPDATE vault_chain_operations SET status='pending',transaction_json=? WHERE owner=? AND key=? AND stage=? AND transaction_json IS NULL",
          )
          .run(JSON.stringify(prepared), session.id, key, op.stage);
        op = this.row(session.id, key)!;
      }
      const tx = JSON.parse(op.transaction_json!) as PreparedVaultTransaction;
      let state = await this.adapter.status(tx);
      if (state === 'pending') {
        // Raw signed bytes were committed above. Lost sends and restarts reuse them.
        try {
          await this.adapter.broadcast(tx.raw);
        } catch {
          /* The signature remains authoritative. */
        }
        for (let i = 0; i < 6 && state === 'pending'; i++) {
          await new Promise((resolve) => setTimeout(resolve, 350));
          state = await this.adapter.status(tx);
        }
      }
      if (state === 'pending')
        throw new ApiError(
          503,
          'CHAIN_PENDING',
          'Confirmation is pending. Resolve this action with its saved request key.',
        );
      if (state === 'expired' || typeof state === 'object') {
        const error =
          state === 'expired'
            ? 'The original transaction expired without confirmation.'
            : `Program execution failed: ${state.error}`;
        this.store.db
          .prepare(
            "UPDATE vault_chain_operations SET status='failed',error=? WHERE owner=? AND key=?",
          )
          .run(error, session.id, key);
        throw new ApiError(409, 'CHAIN_FAILED', error);
      }
      if (tx.stage === 'initialize') {
        await this.adapter.verify(session.id, plan.before, plan.revision);
        this.store.db
          .prepare(
            "UPDATE vault_chain_operations SET status='preparing',stage='execute',transaction_json=NULL WHERE owner=? AND key=? AND stage='initialize'",
          )
          .run(session.id, key);
        continue;
      }
      const observed = await this.adapter.verify(
        session.id,
        plan.book,
        plan.revision + 1,
      );
      const proof = {
        ...observed,
        signature: tx.signature,
        network: 'localnet',
        revision: plan.revision + 1,
      };
      return this.store.transaction(() => {
        const result = this.vault.commit(session, key, plan);
        this.store.db
          .prepare(
            "UPDATE vault_chain_operations SET status='confirmed',proof=? WHERE owner=? AND key=?",
          )
          .run(JSON.stringify(proof), session.id, key);
        return { ...result, mode: 'localnet', chain: proof };
      });
    }
    throw new ApiError(
      503,
      'CHAIN_PENDING',
      'The saved action is still being prepared. Resolve it to continue.',
    );
  }
}
