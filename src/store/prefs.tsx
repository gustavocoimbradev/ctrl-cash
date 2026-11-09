import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CURRENCY_CODES, currencyOfCountry } from '../i18n/currencies';
import { Lang, SHIPPED, deviceLanguage, deviceRegion, getCurrency, getLanguage, saveCachedPrefs, setCurrency, setLanguage } from '../i18n';
import { useStore } from './index';
import { call } from './sync';

interface Prefs {
  language: Lang;
  currency: string;
  /** false until the server has answered, so nothing is saved over a choice we have not read yet */
  loaded: boolean;
  /** applies a choice at once; `save` also keeps it on the account */
  set: (next: { language: Lang; currency: string }, save: boolean) => Promise<void>;
  /** saves what is on screen now (the suggestion of a new account, when the person goes on without touching it) */
  keep: () => Promise<void>;
}

const Ctx = createContext<Prefs | null>(null);

const valid = (s: { language?: string; currency?: string } | null): s is { language: Lang; currency: string } =>
  !!s && SHIPPED.includes(s.language as Lang) && CURRENCY_CODES.includes(s.currency ?? '');

/**
 * The account's language and currency. They come from the server; a brand new account gets a suggestion: the language
 * of the device and the currency of the country the visit comes from (what the edge network reports; the IP address is
 * never read), else of the device's region. Accounts that already hold data keep US dollars, as they always had.
 */
export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const { ready, data } = useStore();
  const [loaded, setLoaded] = useState(false);
  const [stored, setStored] = useState<{ language: Lang; currency: string } | null>(null);
  const [guess, setGuess] = useState<string | null>(null);
  const [, bump] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, region] = await Promise.all([
        call<{ settings: { language: string; currency: string } | null }>('/settings').catch(() => undefined),
        call<{ country: string | null }>('/region').catch(() => null),
      ]);
      if (cancelled || !alive.current) return;
      setGuess(currencyOfCountry(region?.country) ?? currencyOfCountry(deviceRegion()));
      if (settings === undefined) return; // offline: keep what the device remembers and try again on the next visit
      if (valid(settings.settings)) {
        setStored(settings.settings);
        setLanguage(settings.settings.language);
        setCurrency(settings.settings.currency);
        saveCachedPrefs(settings.settings);
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const persist = useCallback(async (next: { language: Lang; currency: string }) => {
    saveCachedPrefs(next);
    setStored(next);
    await call('/settings', { method: 'PUT', body: next });
  }, []);

  // no settings yet: suggest, or (an account that already has data) keep the dollar it always used
  const decided = useRef(false);
  useEffect(() => {
    if (!loaded || !ready || stored || decided.current) return;
    decided.current = true;
    const hasData = data.transactions.length + data.cards.length + data.reserves.length > 0;
    const next = { language: deviceLanguage(), currency: hasData ? 'USD' : guess ?? 'USD' };
    setLanguage(next.language);
    setCurrency(next.currency);
    if (hasData) void persist(next).catch(() => {});
    else bump((n) => n + 1);
  }, [loaded, ready, stored, guess, data, persist]);

  const set = useCallback(
    async (next: { language: Lang; currency: string }, save: boolean) => {
      setLanguage(next.language);
      setCurrency(next.currency);
      if (save) await persist(next);
    },
    [persist],
  );
  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  // never before the server has answered: that would overwrite a choice made on another device
  const keep = useCallback(async () => {
    if (loadedRef.current) await persist({ language: getLanguage(), currency: getCurrency() });
  }, [persist]);

  return <Ctx.Provider value={{ language: getLanguage(), currency: getCurrency(), loaded, set, keep }}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs outside PrefsProvider');
  return v;
}
