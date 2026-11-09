/**
 * Broad, generic expense categories (no micromanagement).
 * `weight` (0 to 1) is how much the spending counts against financial health:
 * 0 = essential and unavoidable, 1 = completely frivolous. Even essentials weigh a
 * little, because spending on them unplanned shows a lack of planning.
 */

import { t } from '../i18n';
import { CategoryRecord } from '../types';

export interface Category {
  slug: string;
  label: string;
  weight: number;
  kind: 'expense' | 'income';
  /** archived: not offered for new transactions; old ones keep showing it */
  archived: boolean;
  /** created by the person (not built in) */
  custom: boolean;
  /** the app logic depends on it: it can be renamed but never archived */
  system: boolean;
}

type Base = { slug: string; label: string; weight: number };

const EXPENSE: Base[] = [
  { slug: 'groceries', label: 'Groceries', weight: 0.1 },
  { slug: 'butcher', label: 'Butcher', weight: 0.15 },
  { slug: 'bills', label: 'Bills', weight: 0.1 },
  { slug: 'health', label: 'Health', weight: 0.1 },
  { slug: 'taxes', label: 'Taxes', weight: 0.1 },
  { slug: 'bureaucracy', label: 'Paperwork', weight: 0.2 },
  { slug: 'education', label: 'Education', weight: 0.15 },
  { slug: 'investments', label: 'Investments', weight: 0.05 },
  { slug: 'refund', label: 'Refund', weight: 0.2 },
  { slug: 'loan', label: 'Loan', weight: 0 },
  { slug: 'car', label: 'Car', weight: 0.4 },
  { slug: 'pets', label: 'Pets', weight: 0.45 },
  { slug: 'personal_care', label: 'Personal care', weight: 0.5 },
  { slug: 'subscriptions', label: 'Subscriptions', weight: 0.55 },
  { slug: 'debts', label: 'Debts', weight: 0.6 },
  { slug: 'gifts', label: 'Gifts', weight: 0.7 },
  { slug: 'leisure', label: 'Leisure', weight: 1 },
  { slug: 'other', label: 'Other', weight: 0.6 },
];

/** Income categories (not part of financial health, so no weight). */
const INCOME: Base[] = [
  { slug: 'salary', label: 'Salary', weight: 0 },
  { slug: 'freelance', label: 'Freelance', weight: 0 },
  { slug: 'refund', label: 'Refund', weight: 0 },
];

/** Loan (card lent to third parties) and Refund (what they pay back) are neutral: they count as neither your spending, income nor debt. */
export const LOAN_CATEGORY = 'loan';
export const REFUND_CATEGORY = 'refund';

/** Old expenses without a category count as "Other". */
export const DEFAULT_CATEGORY = 'other';

/** Categories the app logic relies on: they can be renamed but never archived. */
const SYSTEM = new Set([LOAN_CATEGORY, REFUND_CATEGORY, DEFAULT_CATEGORY]);

/** Impact on financial health a person can pick for an expense category. */
export const IMPACT_LEVELS = [
  { value: 0.1, label: 'Essential' },
  { value: 0.45, label: 'Regular' },
  { value: 0.9, label: 'Discretionary' },
] as const;

/** Id of the record that overrides a built-in category. */
export const builtinRecordId = (kind: 'expense' | 'income', slug: string) => `${kind}_${slug}`;

/** Built-in names, so the checker sees every one (the keys must be static literals). */
function tBuiltin(label: string): string {
  switch (label) {
    case 'Groceries': return t('Groceries');
    case 'Butcher': return t('Butcher');
    case 'Bills': return t('Bills');
    case 'Health': return t('Health');
    case 'Taxes': return t('Taxes');
    case 'Paperwork': return t('Paperwork');
    case 'Education': return t('Education');
    case 'Investments': return t('Investments');
    case 'Refund': return t('Refund');
    case 'Loan': return t('Loan');
    case 'Car': return t('Car');
    case 'Pets': return t('Pets');
    case 'Personal care': return t('Personal care');
    case 'Subscriptions': return t('Subscriptions');
    case 'Debts': return t('Debts');
    case 'Gifts': return t('Gifts');
    case 'Leisure': return t('Leisure');
    case 'Other': return t('Other');
    case 'Salary': return t('Salary');
    case 'Freelance': return t('Freelance');
    default: return label;
  }
}

const build = (records: CategoryRecord[]): Category[] => {
  const byId = new Map(records.map((r) => [r.id, r]));
  const make = (kind: 'expense' | 'income', b: Base): Category => {
    const r = byId.get(builtinRecordId(kind, b.slug));
    const system = kind === 'expense' ? SYSTEM.has(b.slug) : b.slug === REFUND_CATEGORY;
    // built-in names are translated at read time (a getter), unless the person renamed it
    const renamed = r?.name && r.name !== b.label ? r.name : undefined;
    return {
      slug: b.slug,
      kind,
      get label() {
        return renamed ?? tBuiltin(b.label);
      },
      weight: r?.weight ?? b.weight,
      archived: !!r?.archivedAt && !system,
      custom: false,
      system,
    };
  };
  const builtinIds = new Set([...EXPENSE.map((b) => builtinRecordId('expense', b.slug)), ...INCOME.map((b) => builtinRecordId('income', b.slug))]);
  const custom = records
    .filter((r) => !builtinIds.has(r.id))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map((r): Category => ({ slug: r.slug, kind: r.kind, label: r.name, weight: r.weight ?? 0.45, archived: !!r.archivedAt, custom: true, system: false }));
  // "Other" stays last among expenses so it keeps being the fallback
  const exp = EXPENSE.filter((b) => b.slug !== DEFAULT_CATEGORY).map((b) => make('expense', b));
  const other = make('expense', EXPENSE.find((b) => b.slug === DEFAULT_CATEGORY)!);
  return [...exp, ...custom.filter((c) => c.kind === 'expense'), other, ...INCOME.map((b) => make('income', b)), ...custom.filter((c) => c.kind === 'income')];
};

let registry: Category[] = build([]);

/** The store calls this whenever the category records change (module-level registry, so the pure domain code can stay synchronous). */
export function setCategoryRecords(records: CategoryRecord[]) {
  registry = build(records);
}

/** Every category of a kind, archived ones included (for management and for showing old transactions). */
export const allCategories = (kind: 'expense' | 'income'): Category[] => registry.filter((c) => c.kind === kind);

/** Categories offered when creating or editing a transaction. */
export const activeCategories = (kind: 'expense' | 'income'): Category[] => registry.filter((c) => c.kind === kind && !c.archived);

/** An expense category by slug (archived ones still resolve); unknown slugs fall back to "Other". */
export const categoryOf = (slug?: string): Category =>
  registry.find((c) => c.kind === 'expense' && c.slug === slug) ?? registry.find((c) => c.kind === 'expense' && c.slug === DEFAULT_CATEGORY)!;

/** Category name of an expense or income; old income without a category shows as "Income". */
export const categoryLabel = (slug?: string, type: 'expense' | 'income' = 'expense'): string =>
  type === 'income' ? registry.find((c) => c.kind === 'income' && c.slug === slug)?.label ?? t('Income') : categoryOf(slug).label;
