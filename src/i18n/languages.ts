export type Lang = 'en' | 'pt' | 'es' | 'de' | 'fr' | 'it';

/** The languages the app speaks. Each is shown in its own language so anyone can find theirs. */
export const LANGUAGES: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Português' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
];

export const SHIPPED: Lang[] = LANGUAGES.map((l) => l.code);
