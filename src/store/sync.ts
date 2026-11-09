import { Platform } from 'react-native';
import { auth } from '../firebase/auth';
import { AppData, CategoryRecord, CreditCard, InvoicePayment, Reserve, ReserveMove, ShoppingList, Transaction, WishItem } from '../types';

/**
 * Sync with the API (PostgreSQL behind it): GET /api/data and PUT /api/data.
 * The app works on a local state (`AppData`); here it is mirrored to the server. `remote` holds the last known
 * server state as JSON per document, to send only what changed.
 * Nothing is ever deleted: removing something in the app archives it (`archivedAt`), so this module only
 * creates and updates documents, and the API has no delete at all.
 * Firebase is used only to sign in: every request carries the person's Firebase ID token.
 */
export type RemoteMap = Map<string, string>;

/** The API lives on the same origin on the web (`/api`); `EXPO_PUBLIC_API_URL` points elsewhere (development). */
const API = (process.env.EXPO_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');

const COLLECTIONS = ['transactions', 'cards', 'payments', 'reserves', 'reserveMoves', 'categories', 'shoppingLists', 'wishlist'] as const;
type Col = (typeof COLLECTIONS)[number];

/** Poll the server every few seconds while the app is open, so a change made on another device shows up. */
const POLL_MS = 8000;

/** Stable JSON (sorted keys, no undefined) to compare documents. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val).sort().reduce<Record<string, unknown>>((o, k) => {
          if (val[k] !== undefined) o[k] = val[k];
          return o;
        }, {})
      : val,
  );
}

const byCreation = (a: { createdAt?: number; id: string }, b: { createdAt?: number; id: string }) =>
  (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id);

/** One call to the API with the Firebase ID token (refreshed once if the server says it expired). */
export async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await auth.currentUser?.getIdToken(attempt > 0);
    if (!token) throw new Error('not signed in');
    const res = await fetch(`${API}${path}`, {
      method: init?.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 401 && attempt === 0) continue;
    if (!res.ok) throw new Error(`api ${res.status}`);
    return (await res.json()) as T;
  }
  throw new Error('api 401');
}

/** What the server has now, in the app's shape, with its `RemoteMap`. */
async function pull(): Promise<{ data: AppData; remote: RemoteMap }> {
  const body = await call<Record<Col, any[] | undefined>>('/data');
  const remote: RemoteMap = new Map();
  for (const c of COLLECTIONS) for (const doc of body[c] ?? []) remote.set(`${c}/${doc.id}`, stable(doc));
  const list = <T>(c: Col) => [...((body[c] ?? []) as T[])];
  return {
    remote,
    data: {
      transactions: (list<Transaction>('transactions')).sort(byCreation),
      cards: (list<CreditCard>('cards')).sort(byCreation),
      categories: (list<CategoryRecord>('categories')).sort(byCreation),
      payments: (list<InvoicePayment>('payments')).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
      reserves: (list<Reserve>('reserves')).sort(byCreation),
      reserveMoves: (list<ReserveMove>('reserveMoves')).sort((a, b) => a.date.localeCompare(b.date) || byCreation(a, b)),
      shoppingLists: (list<ShoppingList>('shoppingLists')).sort(byCreation),
      wishlist: (list<WishItem>('wishlist')).sort(byCreation),
    },
  };
}

/** Documents of the local state that are new or different from the last known server state. */
function changesOf(remote: RemoteMap, data: AppData) {
  const out: { col: Col; key: string; json: string; doc: { id: string } }[] = [];
  for (const c of COLLECTIONS) {
    for (const doc of data[c] as { id: string }[]) {
      const key = `${c}/${doc.id}`;
      const json = stable(doc);
      if (remote.get(key) !== json) out.push({ col: c, key, json, doc });
    }
  }
  return out;
}

/**
 * Pushes in flight, and how many have finished: while one is running (or one finished while a pull was on its
 * way) what the server says may be older than the local state, so it is not applied over it.
 */
let inflight = 0;
let pushes = 0;

/**
 * Loads everything once and then keeps it fresh: every few seconds and whenever the window gets focus. A newer
 * server state is only applied when there is nothing of the person's own still waiting to be saved.
 */
export function subscribe(
  _uid: string,
  getLocal: () => AppData,
  onData: (data: AppData, remote: RemoteMap) => void,
  onError: (e: unknown) => void,
): () => void {
  let stopped = false;
  let current: RemoteMap | null = null;

  const refresh = async (first: boolean) => {
    try {
      const pushesBefore = pushes;
      const { data, remote } = await pull();
      if (stopped) return;
      if (first) {
        current = remote;
        onData(data, remote);
        return;
      }
      if (!current) return;
      const same = remote.size === current.size && [...remote].every(([k, v]) => current!.get(k) === v);
      // unchanged on the server, or the person has unsaved changes: leave the local state alone
      // (also when a push finished while this pull was on its way: the pull may predate it)
      if (same || inflight > 0 || pushesBefore !== pushes || changesOf(current, getLocal()).length > 0) return;
      current = remote;
      onData(data, remote);
    } catch (e) {
      if (!stopped && first) onError(e);
    }
  };

  void refresh(true);
  const timer = setInterval(() => void refresh(false), POLL_MS);
  const onFocus = () => void refresh(false);
  if (Platform.OS === 'web') {
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
  }
  return () => {
    stopped = true;
    clearInterval(timer);
    if (Platform.OS === 'web') {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    }
  };
}

/** Sends the difference between the local state and the last known server state (in chunks). */
export async function push(_uid: string, remote: RemoteMap, data: AppData): Promise<void> {
  const changes = changesOf(remote, data);
  if (changes.length === 0) return;
  inflight++;
  try {
    for (let i = 0; i < changes.length; i += 400) {
      const chunk = changes.slice(i, i + 400);
      const body: Partial<Record<Col, unknown[]>> = {};
      for (const ch of chunk) (body[ch.col] ??= []).push(ch.doc);
      await call('/data', { method: 'PUT', body });
      // the server has it now
      for (const ch of chunk) remote.set(ch.key, ch.json);
    }
  } finally {
    inflight--;
    pushes++;
  }
}
