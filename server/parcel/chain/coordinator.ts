import { Store, digest, type Session } from '../../db/store';
import { ApiError, object } from '../../http/errors';
import { parseKey } from '../../domain/portfolio';
import { VaultService, type VaultPlan } from '../service';
import type { VaultSnapshot } from '../../../lib/parcel/types';
import type { PreparedVaultTransaction, VaultChainAdapter } from './adapter';
import { ONCHAIN_ACTIONS, actionBytes } from './codec';
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
  action_type: string | null;
  signature: string | null;
  revision_after: number | null;
}
/** Why the program could never carry this plan, or null. Encoding is local
 * and deterministic, so a plan that fails it must never be left pending. */
function unencodable(plan: VaultPlan) {
  try {
    actionBytes(plan);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
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
      mode: this.adapter.network,
      chain: proof ? JSON.parse(proof.proof) : undefined,
      signatures: this.signatures(session.id),
    };
  }
  /** Each receipt a confirmed program transaction wrote, keyed by event id.
   * The signature cannot live on the event itself: the book is hashed
   * onchain before the transaction that carries it is signed. */
  private signatures(owner: string): Record<string, string> {
    const rows = this.store.db
      .prepare(
        "SELECT o.signature, m.detail FROM vault_chain_operations o JOIN vault_mutations m ON m.owner=o.owner AND m.key=o.key WHERE o.owner=? AND o.status='confirmed' AND o.signature IS NOT NULL",
      )
      .all(owner) as { signature: string; detail: string }[];
    const map: Record<string, string> = {};
    for (const row of rows) {
      let events: { id?: unknown }[] = [];
      try {
        events = (JSON.parse(row.detail) as { events?: { id?: unknown }[] })
          .events ?? [];
      } catch {
        continue;
      }
      for (const e of events)
        if (typeof e.id === 'string') map[e.id] = row.signature;
    }
    return map;
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
    // An action another client started (the agent, another tab) holds the
    // session until it resolves. Drive it here from its stored plan instead of
    // refusing a client that never saw its request key.
    const blocker = this.store.db
      .prepare(
        "SELECT key,request_hash FROM vault_chain_operations WHERE owner=? AND key<>? AND status IN ('preparing','pending')",
      )
      .get(session.id, key) as { key: string; request_hash: string } | undefined;
    if (blocker)
      await this.drive(session, blocker.key, blocker.request_hash).catch(
        () => undefined,
      );
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
      // Refused before anything is recorded: an action the program cannot
      // encode would otherwise stay pending and block the session for good.
      const type = object(object(request).action).type;
      if (typeof type !== 'string' || !ONCHAIN_ACTIONS.has(type))
        throw new ApiError(
          409,
          'CHAIN_UNSUPPORTED',
          'This action is not available on the onchain vault.',
        );
      const pending = this.store.db
        .prepare(
          "SELECT key FROM vault_chain_operations WHERE owner=? AND status IN ('preparing','pending')",
        )
        .get(session.id);
      if (pending)
        throw new ApiError(
          409,
          'VAULT_PENDING',
          'An earlier action is still confirming onchain. Try again in a moment.',
        );
      const plan = this.vault.plan(session, value);
      const refused = unencodable(plan);
      if (refused) throw new ApiError(409, 'CHAIN_UNSUPPORTED', refused);
      if (
        plan.book.options.filter((p) => p.status === 'active').length +
          plan.book.loans.filter((p) => p.status === 'active').length +
          plan.book.shorts.filter((p) => p.status === 'active').length +
          plan.book.borrows.filter((p) => p.status === 'active').length >
        64
      )
        throw new ApiError(
          409,
          'CHAIN_CAPACITY',
          'The onchain test vault supports 64 active positions. Close or settle existing positions first.',
        );
      this.store.db
        .prepare(
          "INSERT INTO vault_chain_operations(owner,key,request_hash,plan,status,stage,action_type,created_at) VALUES(?,?,?,?,'preparing','initialize',?,?)",
        )
        .run(
          session.id,
          key,
          hash,
          JSON.stringify(plan),
          String(plan.action.type),
          Date.now(),
        );
    });
    return this.drive(session, key, hash);
  }
  private async drive(
    session: Session,
    key: string,
    hash: string,
  ): Promise<VaultSnapshot> {
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
        return {
          ...receipt,
          mode: this.adapter.network,
          chain: JSON.parse(op.proof!),
          signatures: this.signatures(session.id),
        };
      }
      const plan = JSON.parse(op.plan) as VaultPlan;
      if (!op.transaction_json) {
        // Rows recorded before the encode check above existed.
        const refused = unencodable(plan);
        if (refused) {
          this.store.db
            .prepare(
              "UPDATE vault_chain_operations SET status='failed',error=? WHERE owner=? AND key=? AND transaction_json IS NULL",
            )
            .run(refused, session.id, key);
          throw new ApiError(409, 'CHAIN_UNSUPPORTED', refused);
        }
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
            "UPDATE vault_chain_operations SET status='pending',transaction_json=?,signature=? WHERE owner=? AND key=? AND stage=? AND transaction_json IS NULL",
          )
          .run(
            JSON.stringify(prepared),
            prepared.signature,
            session.id,
            key,
            op.stage,
          );
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
        // Keep signed bytes and signature for forensics; only status/error change.
        // A new request key can proceed once this row is failed (one-pending index).
        this.store.db
          .prepare(
            "UPDATE vault_chain_operations SET status='failed',error=? WHERE owner=? AND key=? AND status='pending'",
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
        network: this.adapter.network,
        revision: plan.revision + 1,
      };
      return this.store.transaction(() => {
        const result = this.vault.commit(session, key, plan, {
          mode: this.adapter.network,
          chain: {
            signature: tx.signature,
            ledger: proof.ledger,
            slot: proof.slot,
            network: this.adapter.network,
          },
        });
        this.store.db
          .prepare(
            "UPDATE vault_chain_operations SET status='confirmed',proof=?,signature=?,revision_after=? WHERE owner=? AND key=?",
          )
          .run(
            JSON.stringify(proof),
            tx.signature,
            plan.revision + 1,
            session.id,
            key,
          );
        return {
          ...result,
          mode: this.adapter.network,
          chain: proof,
          signatures: this.signatures(session.id),
        };
      });
    }
    throw new ApiError(
      503,
      'CHAIN_PENDING',
      'The saved action is still being prepared. Resolve it to continue.',
    );
  }
}
