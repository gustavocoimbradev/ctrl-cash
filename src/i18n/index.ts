import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { dict as auth } from './dict/auth';
import { dict as dashboard } from './dict/dashboard';
import { dict as forms } from './dict/forms';
import { dict as setup } from './dict/setup';
import { dict as social } from './dict/social';
import { SHIPPED, type Lang } from './languages';

export { LANGUAGES, SHIPPED, type Lang } from './languages';

/**
 * Translations. The English text itself is the key: `t('Save')`. A missing translation falls back to the English text,
 * so the app never shows a blank. Placeholders are written `{name}` and filled by `t('Hello {name}', { name })`.
 * Every area keeps its own file in `dict/` (`{ pt, es, de, fr, it }`); they are merged here.
 */
export type Dict = Record<Exclude<Lang, 'en'>, Record<string, string>>;
const merged: Record<string, Record<string, string>> = {};
for (const area of [auth, dashboard, forms, setup, social] as Dict[]) {
  for (const lang of Object.keys(area) as (keyof Dict)[]) Object.assign((merged[lang] ??= {}), area[lang]);
}

/** The BCP 47 locale each language formats numbers and dates with. */
export const LOCALES: Record<Lang, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', it: 'it-IT' };

// ---- the current choice (module level, so plain functions like `formatMoney` and `t` can read it)
let language: Lang = 'en';
let currency = 'USD';
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

export const getLanguage = () => language;
export const getCurrency = () => currency;
export const getLocale = () => LOCALES[language];

export function setLanguage(next: Lang) {
  if (next === language) return;
  language = next;
  if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = next;
  emit();
}

export function setCurrency(next: string) {
  if (next === currency) return;
  currency = next;
  emit();
}

/** Re-renders the component that calls it whenever the language or the currency changes (use it once, near the root). */
export function usePrefsVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
}

/** Translates an English text into the current language. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = language === 'en' ? text : merged[language]?.[text] ?? text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** True when a translation exists for this text in the language (used by the checks). */
export const hasTranslation = (lang: Lang, text: string) => lang === 'en' || merged[lang]?.[text] !== undefined;

// ---- picking a language from the device

/** The device's language when we ship it, otherwise English. */
export function deviceLanguage(): Lang {
  const tags: string[] = [];
  try {
    if (typeof navigator !== 'undefined') {
      if (navigator.languages) tags.push(...navigator.languages);
      if (navigator.language) tags.push(navigator.language);
    }
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // no Intl information: English
  }
  for (const tag of tags) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    const hit = SHIPPED.find((l) => l === base);
    if (hit) return hit;
  }
  return 'en';
}

/** The region of the device's locale ("pt-BR" -> "BR"), or null. */
export function deviceRegion(): string | null {
  const tags: string[] = [];
  try {
    if (typeof navigator !== 'undefined') {
      if (navigator.languages) tags.push(...navigator.languages);
      if (navigator.language) tags.push(navigator.language);
    }
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // none
  }
  for (const tag of tags) {
    const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(tag);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

// ---- remembered on this device, so the sign-in screen already speaks the right language

const KEY = 'ctrlcash:prefs';

export function loadCachedPrefs(): { language?: Lang; currency?: string } {
  try {
    if (Platform.OS !== 'web') return {};
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCachedPrefs(p: { language: Lang; currency: string }) {
  try {
    if (Platform.OS === 'web') window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // private window: nothing is remembered
  }
}

// start from what the device remembers, else from the device itself
{
  const cached = loadCachedPrefs();
  const first: Lang = cached.language && SHIPPED.includes(cached.language) ? cached.language : deviceLanguage();
  language = first;
  if (cached.currency) currency = cached.currency;
  if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = first;
}
