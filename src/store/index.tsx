import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RemoteMap, push, subscribe } from './sync';
import { AppData, CategoryRecord, CreditCard, InvoicePayment, OccurrenceFields, Reserve, ReserveMove, Revision, Tone, Transaction } from '../types';
import { allCategories, builtinRecordId, setCategoryRecords } from '../domain/categories';
import { t } from '../i18n';
import { newId } from '../domain/money';
import { NewTransactionInput, createTransactions } from '../domain/transactions';

export type TransactionPatch = Pick<Transaction, 'type' | 'description' | 'amount' | 'date' | 'cardId' | 'confirmed' | 'category' | 'invoiceKey' | 'reserveId'>;

/** Changes that apply to a fixed transaction's whole series, not just one month. */
export type SeriesPatch = Partial<Pick<Transaction, 'type' | 'cardId' | 'reserveId' | 'invoiceKey'>>;
export type FixedScope = 'one' | 'forward';

const FIELD_KEYS: (keyof OccurrenceFields)[] = ['description', 'amount', 'category', 'day'];

const without = <T extends object>(o: T, keys: string[]): T => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as T;

const empty: AppData = { cards: [], categories: [], transactions: [], payments: [], reserves: [], reserveMoves: [] };

interface Store {
  /** data loaded from the server */
  ready: boolean;
  /** message when syncing fails (no connection, permission...) */
  syncError: string | null;
  /**
   * What the app works with: everything that is not archived. Archived cards stay in here
   * (their purchases and invoices still count; the screens just stop offering them) and
   * `categories` holds the raw category records.
   */
  data: AppData;
  /** archived items (soft deleted), for restoring them */
  archived: { transactions: Transaction[]; payments: InvoicePayment[]; reserves: Reserve[]; cards: CreditCard[] };
  /** returns the created transactions (installments create several) */
  addTransaction: (input: NewTransactionInput) => Transaction[];
  updateTransaction: (id: string, patch: TransactionPatch) => void;
  /**
   * Edits a fixed transaction in a month. `one`: only that month (override). `forward`:
   * from that month onward (revision). `series` (type/card/invoice) always applies
   * to the whole series.
   */
  updateFixed: (id: string, month: string, changes: OccurrenceFields, scope: FixedScope, series?: SeriesPatch) => void;
  toggleConfirmed: (transactionId: string, monthKey: string) => void;
  /** archives the transaction (soft delete); installments are archived as a group */
  archiveTransaction: (transactionId: string) => void;
  /** archives absolutely everything (transactions, payments, reserves and their moves, cards, categories): a fresh start. Nothing is deleted. */
  clearAll: () => void;
  restoreTransaction: (transactionId: string) => void;
  addPayment: (payment: Omit<InvoicePayment, 'id'>) => void;
  archivePayment: (paymentId: string) => void;
  saveReserve: (reserve: Omit<Reserve, 'id'> & { id?: string }) => void;
  /** archives the reserve and its movements (the money goes back to the wallet) */
  archiveReserve: (reserveId: string) => void;
  addReserveMove: (move: Omit<ReserveMove, 'id'>) => void;
  updateReserveMove: (id: string, patch: Partial<Pick<ReserveMove, 'amount' | 'date' | 'confirmed'>>) => void;
  archiveReserveMove: (id: string) => void;
  /** saves the card (creates it without an id) and returns its id */
  saveCard: (card: Omit<CreditCard, 'id'> & { id?: string }) => string;
  /** archives the card: its history stays intact, it just stops being offered */
  archiveCard: (cardId: string) => void;
  restoreCard: (cardId: string) => void;
  /** creates a category, or edits one (a built-in one gets a record the first time it is changed) */
  saveCategory: (input: { kind: 'expense' | 'income'; slug?: string; name: string; weight?: number; tone?: Tone }) => void;
  archiveCategory: (kind: 'expense' | 'income', slug: string) => void;
  restoreCategory: (kind: 'expense' | 'income', slug: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ uid, children }: { uid: string; children: React.ReactNode }) {
  /** everything on the server, archived items included; this is what is synced */
  const [raw, setData] = useState<AppData>(empty);
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const remote = useRef<RemoteMap>(new Map());

  // loads everything from the API, then keeps it fresh (changes from other devices show up within seconds)
  useEffect(
    () =>
      subscribe(
        uid,
        () => rawRef.current,
        (next, map) => {
          remote.current = map;
          setData(next);
          setReady(true);
          setSyncError(null);
        },
        () => setSyncError(t('Could not sync with the cloud. Check your connection and access.')),
      ),
    [uid],
  );

  // writes only what changed since the last remote state
  useEffect(() => {
    if (!ready) return;
    push(uid, remote.current, raw).catch(() => setSyncError(t('Could not save the latest change to the cloud.')));
  }, [raw, ready, uid]);

  // the category registry (module level) follows the records, before anything renders with them
  setCategoryRecords(raw.categories);

  const data = useMemo<AppData>(
    () => ({
      ...raw,
      transactions: raw.transactions.filter((x) => !x.archivedAt),
      payments: raw.payments.filter((x) => !x.archivedAt),
      reserves: raw.reserves.filter((x) => !x.archivedAt),
      reserveMoves: raw.reserveMoves.filter((x) => !x.archivedAt),
    }),
    [raw],
  );
  const archived = useMemo(
    () => ({
      transactions: raw.transactions.filter((x) => x.archivedAt),
      payments: raw.payments.filter((x) => x.archivedAt),
      reserves: raw.reserves.filter((x) => x.archivedAt),
      cards: raw.cards.filter((x) => x.archivedAt),
    }),
    [raw],
  );

  const addTransaction = useCallback((input: NewTransactionInput) => {
    const created = createTransactions(input);
    setData((d) => ({ ...d, transactions: [...d.transactions, ...created] }));
    return created;
  }, []);

  /**
   * Updates a transaction. For installments, description, type and card apply to the
   * whole group; amount, date and confirmation only to the edited installment. For fixed ones,
   * `confirmed` is ignored (confirmation is per month).
   */
  const updateTransaction = useCallback((id: string, patch: TransactionPatch) => {
    setData((d) => {
      const target = d.transactions.find((t) => t.id === id);
      const group = target?.installment?.groupId;
      return {
        ...d,
        transactions: d.transactions.map((t): Transaction => {
          if (t.id === id) {
            const next = { ...t, ...patch, confirmed: t.fixed ? t.confirmed : patch.confirmed };
            if (t.fixed) {
              // a whole-series change overrides per-month edits of the same fields
              const keys = ['description', 'amount'].filter((k) => (patch as any)[k] !== (t as any)[k]);
              if (keys.length && t.revisions) next.revisions = t.revisions.map((r) => without(r, keys) as Revision).filter((r) => Object.keys(r).length > 1);
              if (keys.length && t.overrides) next.overrides = Object.fromEntries(Object.entries(t.overrides).map(([m, o]) => [m, without(o, keys)] as const).filter(([, o]) => Object.keys(o).length > 0));
              if (next.revisions && next.revisions.length === 0) delete next.revisions;
              if (next.overrides && Object.keys(next.overrides).length === 0) delete next.overrides;
            }
            return next;
          }
          if (group && t.installment?.groupId === group) {
            return { ...t, type: patch.type, description: patch.description, category: patch.category, cardId: patch.cardId, reserveId: patch.reserveId };
          }
          return t;
        }),
      };
    });
  }, []);

  const updateFixed = useCallback((id: string, month: string, changes: OccurrenceFields, scope: FixedScope, series?: SeriesPatch) => {
    setData((d) => ({
      ...d,
      transactions: d.transactions.map((t): Transaction => {
        if (t.id !== id || !t.fixed) return t;
        const next: Transaction = { ...t, ...series };
        const keys = FIELD_KEYS.filter((k) => changes[k] !== undefined) as string[];
        if (keys.length === 0) return next;
        if (scope === 'one') {
          next.overrides = { ...(t.overrides ?? {}), [month]: { ...(t.overrides?.[month] ?? {}), ...changes } };
          return next;
        }
        // "this and following": anything later with the same fields is superseded
        const revisions = (t.revisions ?? [])
          .map((r): Revision => (r.from > month ? (without(r, keys) as Revision) : r))
          .filter((r) => Object.keys(r).length > 1);
        const same = revisions.find((r) => r.from === month);
        next.revisions = same
          ? revisions.map((r) => (r === same ? { ...r, ...changes } : r))
          : [...revisions, { from: month, ...changes }];
        if (t.overrides) {
          const overrides = Object.fromEntries(
            Object.entries(t.overrides)
              .map(([m, o]) => [m, m >= month ? without(o, keys) : o] as const)
              .filter(([, o]) => Object.keys(o).length > 0),
          );
          next.overrides = overrides;
          if (Object.keys(overrides).length === 0) delete next.overrides;
        }
        return next;
      }),
    }));
  }, []);

  const toggleConfirmed = useCallback((id: string, mKey: string) => {
    setData((d) => ({
      ...d,
      transactions: d.transactions.map((t): Transaction => {
        if (t.id !== id) return t;
        if (!t.fixed) return { ...t, confirmed: !t.confirmed };
        const has = t.confirmedMonths.includes(mKey);
        return {
          ...t,
          confirmedMonths: has ? t.confirmedMonths.filter((m) => m !== mKey) : [...t.confirmedMonths, mKey],
        };
      }),
    }));
  }, []);

  const setArchived = (group: (t: Transaction) => boolean, at: number | undefined) => (d: AppData): AppData => ({
    ...d,
    transactions: d.transactions.map((t) => (group(t) ? { ...t, archivedAt: at } : t)),
  });
  const archiveTransaction = useCallback((id: string) => {
    setData((d) => {
      const group = d.transactions.find((t) => t.id === id)?.installment?.groupId;
      return setArchived((t) => (group ? t.installment?.groupId === group : t.id === id), Date.now())(d);
    });
  }, []);
  const clearAll = useCallback(() => {
    const at = Date.now();
    const mark = <T extends { archivedAt?: number }>(list: T[]): T[] => list.map((x) => (x.archivedAt ? x : { ...x, archivedAt: at }));
    setData((d) => ({
      transactions: mark(d.transactions),
      payments: mark(d.payments),
      reserves: mark(d.reserves),
      reserveMoves: mark(d.reserveMoves),
      cards: mark(d.cards),
      categories: mark(d.categories),
    }));
  }, []);
  const restoreTransaction = useCallback((id: string) => {
    setData((d) => {
      const group = d.transactions.find((t) => t.id === id)?.installment?.groupId;
      return setArchived((t) => (group ? t.installment?.groupId === group : t.id === id), undefined)(d);
    });
  }, []);

  const addPayment = useCallback((payment: Omit<InvoicePayment, 'id'>) => {
    setData((d) => ({ ...d, payments: [...d.payments, { ...payment, id: newId() }] }));
  }, []);

  const archivePayment = useCallback((id: string) => {
    setData((d) => ({ ...d, payments: d.payments.map((p) => (p.id === id ? { ...p, archivedAt: Date.now() } : p)) }));
  }, []);

  const saveReserve = useCallback((reserve: Omit<Reserve, 'id'> & { id?: string }) => {
    setData((d) => {
      if (reserve.id && d.reserves.some((r) => r.id === reserve.id)) return { ...d, reserves: d.reserves.map((r) => (r.id === reserve.id ? { ...r, ...reserve, id: r.id } : r)) };
      return { ...d, reserves: [...d.reserves, { ...reserve, id: reserve.id ?? newId(), createdAt: Date.now() }] };
    });
  }, []);

  const archiveReserve = useCallback((id: string) => {
    const at = Date.now();
    setData((d) => ({
      ...d,
      reserves: d.reserves.map((r) => (r.id === id ? { ...r, archivedAt: at } : r)),
      reserveMoves: d.reserveMoves.map((m) => (m.reserveId === id ? { ...m, archivedAt: m.archivedAt ?? at } : m)),
    }));
  }, []);

  const addReserveMove = useCallback((move: Omit<ReserveMove, 'id'>) => {
    setData((d) => ({ ...d, reserveMoves: [...d.reserveMoves, { ...move, id: newId(), createdAt: Date.now() }] }));
  }, []);

  const updateReserveMove = useCallback((id: string, patch: Partial<Pick<ReserveMove, 'amount' | 'date' | 'confirmed'>>) => {
    setData((d) => ({ ...d, reserveMoves: d.reserveMoves.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  }, []);

  const archiveReserveMove = useCallback((id: string) => {
    setData((d) => ({ ...d, reserveMoves: d.reserveMoves.map((m) => (m.id === id ? { ...m, archivedAt: Date.now() } : m)) }));
  }, []);

  const saveCard = useCallback((card: Omit<CreditCard, 'id'> & { id?: string }) => {
    const id = card.id ?? newId();
    setData((d) => {
      if (d.cards.some((c) => c.id === id)) {
        return { ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, ...card, id: c.id } : c)) };
      }
      return { ...d, cards: [...d.cards, { ...card, id, createdAt: Date.now() }] };
    });
    return id;
  }, []);

  // archiving a card keeps everything it ever did (purchases, installments, invoices, payments)
  const archiveCard = useCallback((cardId: string) => {
    setData((d) => ({ ...d, cards: d.cards.map((c) => (c.id === cardId ? { ...c, archivedAt: Date.now() } : c)) }));
  }, []);
  const restoreCard = useCallback((cardId: string) => {
    setData((d) => ({ ...d, cards: d.cards.map((c) => (c.id === cardId ? { ...c, archivedAt: undefined } : c)) }));
  }, []);

  const saveCategory = useCallback((input: { kind: 'expense' | 'income'; slug?: string; name: string; weight?: number; tone?: Tone }) => {
    setData((d) => {
      const name = input.name.trim();
      const weight = input.kind === 'expense' ? input.weight : undefined;
      const tone = input.kind === 'expense' ? input.tone : undefined;
      const extra = { ...(weight !== undefined ? { weight } : {}), ...(tone !== undefined ? { tone } : {}) };
      if (!input.slug) {
        const id = newId();
        const rec: CategoryRecord = { id, slug: id, kind: input.kind, name, ...extra, createdAt: Date.now() };
        return { ...d, categories: [...d.categories, rec] };
      }
      // existing: a built-in one (record id by kind and slug) or a custom one (record id = slug)
      const builtinId = builtinRecordId(input.kind, input.slug);
      const found = d.categories.find((r) => r.id === builtinId || (r.slug === input.slug && r.kind === input.kind));
      if (found) return { ...d, categories: d.categories.map((r) => (r === found ? { ...r, name, ...extra } : r)) };
      const rec: CategoryRecord = { id: builtinId, slug: input.slug, kind: input.kind, name, ...extra, createdAt: Date.now() };
      return { ...d, categories: [...d.categories, rec] };
    });
  }, []);

  const setCategoryArchived = useCallback((kind: 'expense' | 'income', slug: string, at: number | undefined) => {
    setData((d) => {
      const found = d.categories.find((r) => r.kind === kind && r.slug === slug);
      if (found) return { ...d, categories: d.categories.map((r) => (r === found ? { ...r, archivedAt: at } : r)) };
      // a built-in category without a record yet: the record is created carrying its current name
      const builtin = allCategories(kind).find((c) => c.slug === slug);
      if (!builtin) return d;
      const rec: CategoryRecord = { id: builtinRecordId(kind, slug), slug, kind, name: builtin.label, ...(kind === 'expense' ? { weight: builtin.weight } : {}), createdAt: Date.now(), archivedAt: at };
      return { ...d, categories: [...d.categories, rec] };
    });
  }, []);
  const archiveCategory = useCallback((kind: 'expense' | 'income', slug: string) => setCategoryArchived(kind, slug, Date.now()), [setCategoryArchived]);
  const restoreCategory = useCallback((kind: 'expense' | 'income', slug: string) => setCategoryArchived(kind, slug, undefined), [setCategoryArchived]);

  const value = useMemo(
    () => ({ ready, syncError, data, archived, addTransaction, updateTransaction, updateFixed, toggleConfirmed, archiveTransaction, clearAll, restoreTransaction, addPayment, archivePayment, saveReserve, archiveReserve, addReserveMove, updateReserveMove, archiveReserveMove, saveCard, archiveCard, restoreCard, saveCategory, archiveCategory, restoreCategory }),
    [ready, syncError, data, archived, addTransaction, updateTransaction, updateFixed, toggleConfirmed, archiveTransaction, clearAll, restoreTransaction, addPayment, archivePayment, saveReserve, archiveReserve, addReserveMove, updateReserveMove, archiveReserveMove, saveCard, archiveCard, restoreCard, saveCategory, archiveCategory, restoreCategory],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore fora do StoreProvider');
  return s;
}
