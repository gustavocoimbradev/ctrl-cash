export type TransactionType = 'income' | 'expense';

export interface Installment {
  index: number;
  total: number;
  groupId: string;
}

/** Fields of a fixed transaction that can change per month. */
export interface OccurrenceFields {
  description?: string;
  /** cents */
  amount?: number;
  category?: string;
  /** day of the month (1-31) */
  day?: number;
}

/** "This and following": applies from month `from` onward (the newest win). */
export interface Revision extends OccurrenceFields {
  from: string;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  description: string;
  /** cents, always positive */
  amount: number;
  /** purchase/transaction date, YYYY-MM-DD */
  date: string;
  confirmed: boolean;
  /** fixed: repeats every month from `date` */
  fixed: boolean;
  /** confirmed months (YYYY-MM) of a fixed transaction */
  confirmedMonths: string[];
  cardId?: string;
  /** chosen invoice (due month, YYYY-MM); only for card purchases */
  invoiceKey?: string;
  /** expense paid from a reserve's balance (instead of the wallet or a card) */
  reserveId?: string;
  category?: string;
  installment?: Installment;
  /** ms since the epoch; defines creation order */
  createdAt?: number;
  /** fixed: changes from a month onward ("this and following") */
  revisions?: Revision[];
  /** fixed: changes for a single month ("only this"), key YYYY-MM */
  overrides?: Record<string, OccurrenceFields>;
  /** soft delete: ms since the epoch when it was archived. Nothing is ever deleted; archived items just leave the lists and the math. */
  archivedAt?: number;
  /** made by an assistant through MCP (a small mark is shown); absent when the person made it */
  source?: 'claude';
}

/** Reserve: money set apart from the main wallet. */
export interface Reserve {
  id: string;
  name: string;
  /** optional goal in cents; enables the progress bar */
  goal?: number;
  createdAt?: number;
  /** soft delete: ms since the epoch when it was archived. Nothing is ever deleted; archived items just leave the lists and the math. */
  archivedAt?: number;
}

/** Movement between the main wallet and a reserve. */
export interface ReserveMove {
  id: string;
  reserveId: string;
  /** deposit: carteira → reserva; withdraw: reserva → carteira */
  type: 'deposit' | 'withdraw';
  /** cents */
  amount: number;
  date: string;
  /** confirmed = already happened; absent counts as confirmed (old data) */
  confirmed?: boolean;
  createdAt?: number;
  /** soft delete: ms since the epoch when it was archived. Nothing is ever deleted; archived items just leave the lists and the math. */
  archivedAt?: number;
}

export interface InvoicePayment {
  id: string;
  cardId: string;
  /** paid invoice, identified by due month (YYYY-MM) */
  invoiceKey: string;
  /** cents */
  amount: number;
  /** payment date, YYYY-MM-DD */
  date: string;
  /** soft delete: ms since the epoch when it was archived. Nothing is ever deleted; archived items just leave the lists and the math. */
  archivedAt?: number;
  source?: 'claude';
}

export interface CreditCard {
  id: string;
  name: string;
  /** cents */
  limit: number;
  dueDay: number;
  /** card color in charts and lists (#RRGGBB); absent = default color by position */
  color?: string;
  createdAt?: number;
  /** soft delete: ms since the epoch when it was archived. Nothing is ever deleted; archived items just leave the lists and the math. */
  archivedAt?: number;
  source?: 'claude';
}

/** Concrete occurrence of a transaction (fixed ones are expanded per month). */
export interface Occurrence {
  key: string;
  transactionId: string;
  type: TransactionType;
  description: string;
  amount: number;
  /** effective date (invoice due date for cards) */
  date: string;
  purchaseDate: string;
  confirmed: boolean;
  fixed: boolean;
  cardId?: string;
  reserveId?: string;
  category?: string;
  installment?: Installment;
  /** creation position (0 = oldest) */
  order: number;
  /** YYYY-MM used to confirm fixed occurrences */
  monthKey: string;
}

/**
 * Category stored on the server. Built-in categories exist in code and only get a record when
 * the person changes them (id `${kind}_${slug}`); custom ones are always records (slug = id).
 */
/** How an expense category counts for financial health. */
export type Tone = 'healthy' | 'necessary' | 'comfort' | 'luxury' | 'unhealthy' | 'unknown';

export interface CategoryRecord {
  id: string;
  /** what transactions store in `category` */
  slug: string;
  kind: TransactionType;
  name: string;
  /** expenses only: how much spending here weighs against financial health, 0 (essential) to 1 (futile) */
  weight?: number;
  /** expenses only: the person's own classification (healthy, necessary...); absent = the app's default for it */
  tone?: Tone;
  createdAt?: number;
  archivedAt?: number;
  source?: 'claude';
}

/** One thing on a shopping list. Removing it archives it (nothing is ever deleted). */
export interface ShoppingItem {
  id: string;
  name: string;
  /** checked off while shopping */
  done: boolean;
  archivedAt?: number;
}

/** A shopping list: its items, and when the shopping was finished (the grocery expense was created then). */
export interface ShoppingList {
  id: string;
  name: string;
  items: ShoppingItem[];
  /** ms since the epoch: the shopping is over and billed */
  finishedAt?: number;
  createdAt?: number;
  archivedAt?: number;
}

/** Something the person wants to buy. Archiving hides it; `boughtAt` says it was bought (and billed). */
export interface WishItem {
  id: string;
  name: string;
  /** smallest currency unit (cents for dollars); optional */
  price?: number;
  /** where to buy it online; http(s) only */
  url?: string;
  note?: string;
  boughtAt?: number;
  createdAt?: number;
  archivedAt?: number;
}

export interface AppData {
  cards: CreditCard[];
  categories: CategoryRecord[];
  transactions: Transaction[];
  payments: InvoicePayment[];
  reserves: Reserve[];
  reserveMoves: ReserveMove[];
  shoppingLists: ShoppingList[];
  wishlist: WishItem[];
}
