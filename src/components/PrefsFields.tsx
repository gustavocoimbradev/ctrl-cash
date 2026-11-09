import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { CURRENCY_CODES, currencyLabel } from '../i18n/currencies';
import { LANGUAGES, Lang, getCurrency, getLanguage, t } from '../i18n';
import { usePrefs } from '../store/prefs';
import { spacing, type, useColors } from '../theme';
import { Select } from './Select';

/**
 * The two choices that shape the whole app: the language and the currency. Used by the quick setup and by the account
 * settings. A pick applies at once (the screen changes language under the person's finger); `save` also keeps it on the
 * account right away.
 */
export function PrefsFields({ save }: { save: boolean }) {
  const c = useColors();
  const { set, language, currency } = usePrefs();
  const [error, setError] = useState('');

  // the list follows the language: names, order and symbols are in the language on screen
  const currencies = useMemo(
    () =>
      CURRENCY_CODES.map((code) => ({ value: code, label: currencyLabel(code) })).sort((a, b) => a.label.localeCompare(b.label, getLanguage())),
    [language],
  );
  const languages = useMemo(() => LANGUAGES.map((l) => ({ value: l.code, label: l.name })), []);

  const apply = (next: { language: Lang; currency: string }) => {
    setError('');
    set(next, save).catch(() => setError(t('Could not save. Try again.')));
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <Select label={t('Language')} value={language} options={languages} onChange={(v) => apply({ language: v as Lang, currency: getCurrency() })} />
      <Select label={t('Currency')} value={currency} options={currencies} onChange={(v) => apply({ language: getLanguage(), currency: String(v) })} />
      <Text style={[type.body, { color: c.textMuted }]}>{t('Changing the currency only changes how amounts are shown: nothing is converted.')}</Text>
      {error ? <Text style={[type.body, { color: c.expense }]}>{error}</Text> : null}
    </View>
  );
}
