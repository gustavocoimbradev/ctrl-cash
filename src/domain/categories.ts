/**
 * Broad, generic expense categories (no micromanagement).
 * `weight` (0 to 1) is how much the spending counts against financial health:
 * 0 = essential and unavoidable, 1 = completely frivolous. Even essentials weigh a
 * little, because spending on them unplanned shows a lack of planning.
 */

import { t } from '../i18n';
import { CategoryRecord, Tone } from '../types';

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
  /** how it counts for financial health (expenses only); the person's choice, else a default */
  tone: Tone | null;
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
  { slug: 'delivery', label: 'Delivery', weight: 0.8 },
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
    case 'Delivery': return t('Delivery');
    case 'Debts': return t('Debts');
    case 'Gifts': return t('Gifts');
    case 'Leisure': return t('Leisure');
    case 'Other': return t('Other');
    case 'Salary': return t('Salary');
    case 'Freelance': return t('Freelance');
    default: return label;
  }
}

/* these two are used by `build` below, which runs at load: they must be defined before it */
/** The app's default tone of a built-in category, in words anybody understands. */
const TONES: Record<string, Tone> = {
  investments: 'healthy',
  groceries: 'necessary',
  butcher: 'necessary',
  bills: 'necessary',
  health: 'necessary',
  taxes: 'necessary',
  bureaucracy: 'necessary',
  education: 'necessary',
  car: 'comfort',
  pets: 'comfort',
  personal_care: 'comfort',
  subscriptions: 'luxury',
  delivery: 'unhealthy',
  gifts: 'luxury',
  leisure: 'luxury',
  debts: 'unhealthy',
  other: 'unknown',
};

/** Default tone from the impact weight, for a category without a built-in tone and without a choice. */
export const toneFromWeight = (weight: number): Tone => (weight <= 0.2 ? 'necessary' : weight <= 0.5 ? 'comfort' : 'luxury');

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
      tone: kind === 'expense' ? r?.tone ?? TONES[b.slug] ?? toneFromWeight(r?.weight ?? b.weight) : null,
    };
  };
  const builtinIds = new Set([...EXPENSE.map((b) => builtinRecordId('expense', b.slug)), ...INCOME.map((b) => builtinRecordId('income', b.slug))]);
  const custom = records
    .filter((r) => !builtinIds.has(r.id))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map((r): Category => ({ slug: r.slug, kind: r.kind, label: r.name, weight: r.weight ?? 0.45, archived: !!r.archivedAt, custom: true, system: false, tone: r.kind === 'expense' ? r.tone ?? toneFromWeight(r.weight ?? 0.45) : null }));
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

/**
 * The name to show for a category in somebody else's shared summary: a built-in one is shown in MY language (the slug
 * is the same for everybody); a custom one keeps the name its owner gave it.
 */
export const sharedCategoryLabel = (slug: string, given: string): string => {
  const base = EXPENSE.find((b) => b.slug === slug);
  return base ? tBuiltin(base.label) : given;
};

/** The built-in default of a slug (used for snapshots that do not carry a tone); null when there is none. */
export const defaultTone = (slug: string): Tone | null => TONES[slug] ?? null;

export const TONE_LIST: Tone[] = ['healthy', 'necessary', 'comfort', 'luxury', 'unhealthy', 'unknown'];

export const TONE_COLORS: Record<Tone, string> = {
  healthy: '#1FA86A',
  necessary: '#5B6CC4',
  comfort: '#D9A31F',
  luxury: '#C25BD6',
  unhealthy: '#DC2626',
  unknown: '#8A94AB',
};

/** The tone's name in the language on screen. */
export function toneLabel(tone: Tone): string {
  switch (tone) {
    case 'healthy': return t('Healthy');
    case 'necessary': return t('Necessary');
    case 'comfort': return t('Comfort');
    case 'luxury': return t('Luxury');
    case 'unhealthy': return t('Unhealthy');
    case 'unknown': return t('Unknown');
  }
}

/** A color per built-in category, from its tone: green for what builds wealth, red for debt, blues for what is necessary, warm colors for comfort and luxury. */
const SLUG_COLORS: Record<string, string> = {
  investments: '#1FA86A',
  groceries: '#3B82F6',
  butcher: '#60A5FA',
  bills: '#4F46E5',
  health: '#0EA5E9',
  taxes: '#6366F1',
  bureaucracy: '#0891B2',
  education: '#818CF8',
  car: '#D9A31F',
  pets: '#B98A5E',
  personal_care: '#F0B429',
  subscriptions: '#C25BD6',
  delivery: '#F97316',
  gifts: '#F28BA3',
  leisure: '#8B5CF6',
  debts: '#DC2626',
  other: '#9AA5BC',
};
export const categoryColor = (slug: string): string | null => SLUG_COLORS[slug] ?? null;

/** The English name a built-in category is stored under when it is renamed or edited without a new name (never the translated one). */
export const builtinBaseName = (kind: 'expense' | 'income', slug: string): string | undefined => (kind === 'expense' ? EXPENSE : INCOME).find((b) => b.slug === slug)?.label;

/** The tone of one of MY expense categories by slug. */
export const toneOfCategory = (slug: string): Tone | null => registry.find((c) => c.kind === 'expense' && c.slug === slug)?.tone ?? null;
