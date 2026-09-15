import { randomUUID } from 'node:crypto';
import type { SessionPortfolio } from '../../lib/contracts/api';
import {
  conservation,
  initialBook,
  transition,
  units,
  validate,
  type Action,
  type Terms,
} from '../../lib/engine';
import { priceOn, rowsFor, scenarios } from '../../lib/scenarios';
import { Store, digest, type Session } from '../db/store';
import { ApiError, object } from '../http/errors';
export function parseTerms(value: unknown): Terms {
  const t = object(value);
  const fields = [
    'kind',
    'low',
    'high',
    'quantity',
    'premium',
    'expiry',
    'scenario',
  ];
  if (
    fields.some((k) => !(k in t)) ||
    Object.keys(t).some((k) => !fields.includes(k))
  )
    throw new ApiError(
      400,
      'INVALID_TERMS',
      'Provide exactly the supported spread terms.',
    );
  if (
    typeof t.kind !== 'string' ||
    typeof t.expiry !== 'string' ||
    typeof t.scenario !== 'string' ||
    !['low', 'high', 'quantity', 'premium'].every(
      (k) => typeof t[k] === 'number',
    )
  )
    throw new ApiError(
      400,
      'INVALID_TERMS',
      'Price and quantity fields must be numbers.',
    );
  const result = t as unknown as Terms;
  try {
    validate(result);
  } catch (e) {
    throw new ApiError(400, 'INVALID_TERMS', (e as Error).message);
  }
  const scenario = scenarios.find((s) => s.id === t.scenario);
  if (
    !scenario ||
    result.expiry <= scenario.entry ||
    result.expiry > scenario.end
  )
    throw new ApiError(
      400,
      'INVALID_EXPIRY',
      'Settlement must be a session after entry within the selected replay.',
    );
  return { ...result };
}
export function parseKey(key: unknown): string {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
    throw new ApiError(
      400,
      'IDEMPOTENCY_REQUIRED',
      'A valid Idempotency-Key is required.',
    );
  return key;
}
export class PortfolioService {
  constructor(
    private store: Store,
    private clock = Date.now,
  ) {}
  apply(session: Session, key: string, value: unknown): SessionPortfolio {
    parseKey(key);
    const request = object(value),
      a = object(request.action);
    if (!Number.isSafeInteger(request.revision) || Number(request.revision) < 0)
      throw new ApiError(
        400,
        'REVISION_REQUIRED',
        'Provide the portfolio revision you reviewed.',
      );
    const hash = digest(JSON.stringify(request));
    return this.store.transaction(() => {
      const cached = this.store.receipt(session.id, key, hash) as
        | SessionPortfolio
        | undefined;
      if (cached) return cached;
      const current = this.store.portfolio(session);
      if (current.revision !== request.revision)
        throw new ApiError(
          409,
          'STALE_REVISION',
          'Your portfolio changed in another request. Refresh and review before retrying.',
        );
      const now = this.clock();
      let action: Action;
      if (a.type === 'reset') {
        this.store.saveBook(session.id, initialBook(), current.revision + 1);
      } else {
        const id = typeof a.id === 'string' ? a.id : '';
        if (a.type === 'request')
          action = {
            type: 'request',
            terms: parseTerms(a.terms),
            id: `RFQ-${randomUUID().slice(0, 8).toUpperCase()}`,
            now,
          };
        else if (a.type === 'fund') {
          if (typeof a.premium !== 'number')
            throw new ApiError(
              400,
              'INVALID_PREMIUM',
              'Premium must be numeric.',
            );
          action = { type: 'fund', id, premium: a.premium, now };
        } else if (
          a.type === 'accept' ||
          a.type === 'cancel' ||
          a.type === 'expire'
        )
          action = { type: a.type, id, now };
        else if (a.type === 'claim') {
          if (a.party !== 'holder' && a.party !== 'maker')
            throw new ApiError(400, 'INVALID_PARTY', 'Choose holder or maker.');
          action = { type: 'claim', id, party: a.party, now };
        } else if (a.type === 'settle') {
          const p = current.book.positions.find((p) => p.id === id);
          if (!p)
            throw new ApiError(
              404,
              'POSITION_NOT_FOUND',
              'Position not found.',
            );
          if (
            typeof a.date !== 'string' ||
            !rowsFor(p.terms.scenario).some((r) => r.date === a.date) ||
            typeof a.available !== 'boolean'
          )
            throw new ApiError(
              400,
              'INVALID_OBSERVATION',
              'Choose a valid replay session and observation availability.',
            );
          if ('price' in a && a.price !== priceOn(p.terms.expiry))
            throw new ApiError(
              400,
              'INVALID_OBSERVATION',
              'The settlement price is fixed by the backend dataset.',
            );
          action = {
            type: 'settle',
            id,
            price: priceOn(p.terms.expiry),
            date: a.date,
            available: a.available,
            now,
          };
        } else
          throw new ApiError(
            400,
            'UNKNOWN_ACTION',
            'This portfolio action is not supported.',
          );
        if (current.book.positions.length >= 200 && a.type === 'request')
          throw new ApiError(
            409,
            'SESSION_LIMIT',
            'This demo session has reached 200 requests. Export and reset practice to continue.',
          );
        try {
          const book = transition(current.book, action);
          if (units(conservation(book)) !== units(conservation(current.book)))
            throw new Error('Collateral conservation failed.');
          this.store.saveBook(session.id, book, current.revision + 1);
        } catch (e) {
          if (e instanceof ApiError) throw e;
          throw new ApiError(409, 'ACTION_REJECTED', (e as Error).message);
        }
      }
      this.store.audit(
        session.id,
        'portfolio',
        JSON.stringify({ type: a.type, id: a.id || null }),
      );
      const result = this.store.portfolio(session);
      result.serverTime = now;
      this.store.saveReceipt(session.id, key, hash, result);
      return result;
    });
  }
}
