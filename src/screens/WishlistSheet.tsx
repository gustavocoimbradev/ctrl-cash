import { Feather } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { MoneyField, TextField } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { Advice, Verdict, financialProfile, wishAdvice } from '../domain/wishAdvice';
import { shortDate } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { t } from '../i18n';
import { useStore } from '../store';
import { radius, spacing, type, useColors } from '../theme';
import { WishItem } from '../types';

const isLink = (v: string) => /^https?:\/\/\S+$/i.test(v);

/** A link as people type it: "shop.com/x" gets https:// in front. */
const normalizeLink = (v: string) => {
  const s = v.trim();
  return s && !/^[a-z][a-z0-9+.-]*:/i.test(s) ? `https://${s}` : s;
};

const VERDICT: Record<Verdict, { icon: keyof typeof Feather.glyphMap; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  cash: { icon: 'check-circle', tone: 'good' },
  wait: { icon: 'clock', tone: 'good' },
  installments: { icon: 'credit-card', tone: 'warn' },
  notYet: { icon: 'x-circle', tone: 'bad' },
  unknown: { icon: 'info', tone: 'neutral' },
};

/**
 * Things the person wants to buy: a price and, for online shops, the link. With a price, each item says whether it is better
 * to buy in cash, in installments or to wait, from the person's own profile (cash, monthly leftover, card limit and debt).
 */
export function WishlistSheet({ visible, onClose, onBought }: { visible: boolean; onClose: () => void; onBought: (item: WishItem) => void }) {
  const c = useColors();
  const { data, saveWish, archiveWish } = useStore();
  const [open, setOpen] = useState<{ id?: string } | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const profile = useMemo(() => (visible ? financialProfile(data) : null), [data, visible]);
  const items = data.wishlist;
  const wanted = items.filter((i) => !i.boughtAt);
  const bought = items.filter((i) => i.boughtAt).sort((a, b) => (b.boughtAt ?? 0) - (a.boughtAt ?? 0));
  const current = open?.id ? items.find((i) => i.id === open.id) : undefined;

  useEffect(() => {
    if (!open) return;
    setName(current?.name ?? '');
    setPrice(current?.price ?? 0);
    setUrl(current?.url ?? '');
    setNote(current?.note ?? '');
    setTried(false);
  }, [open?.id, !!open]);

  const colorOf = (tone: 'good' | 'warn' | 'bad' | 'neutral') => (tone === 'good' ? c.income : tone === 'warn' ? c.warning : tone === 'bad' ? c.expense : c.textMuted);
  const adviceOf = (p?: number): Advice | null => (profile ? wishAdvice(profile, p) : null);

  const link = normalizeLink(url);
  const nameError = name.trim() ? undefined : t('Enter what you want');
  const urlError = url.trim() && !isLink(link) ? t('Enter a link that starts with http:// or https://') : undefined;
  const save = () => {
    setTried(true);
    if (nameError || urlError) return;
    saveWish({
      ...(current ?? {}),
      id: current?.id,
      name: name.trim(),
      price: price > 0 ? price : undefined,
      url: url.trim() ? link : undefined,
      note: note.trim() || undefined,
    });
    setOpen(null);
  };

  const live = price > 0 ? adviceOf(price) : adviceOf(undefined);
  const row = (i: WishItem) => {
    const a = i.price && !i.boughtAt ? adviceOf(i.price) : null;
    const v = a ? VERDICT[a.verdict] : null;
    return (
      <Pressable
        key={i.id}
        accessibilityRole="button"
        accessibilityLabel={t('Open {title}', { title: i.name })}
        onPress={() => setOpen({ id: i.id })}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.label, { color: c.text }]}>{i.name}</Text>
          <Text style={[type.body, { color: v && a ? colorOf(v.tone) : c.textMuted }]}>
            {i.boughtAt ? t('Bought {date}', { date: shortDate(i.boughtAt, true) }) : a ? a.headline : t('No price yet')}
          </Text>
        </View>
        {i.price ? <Text style={[type.label, { color: c.text }]}>{formatMoney(i.price)}</Text> : null}
      </Pressable>
    );
  };

  return (
    <Sheet screen visible={visible} title={t('Wishlist')} onClose={onClose} footer={<Button label={t('New wish')} icon="plus" onPress={() => setOpen({})} flex />}>
      <Text style={[type.body, { color: c.textMuted }]}>{t('Put here what you want to buy, with the price and the link. We tell you if it is better to buy in cash, in installments or to wait, from your own numbers.')}</Text>
      {items.length === 0 ? <Text style={[type.body, { color: c.text }]}>{t('Nothing here yet.')}</Text> : null}
      {wanted.length > 0 ? <View style={{ gap: spacing.sm }}>{wanted.map(row)}</View> : null}
      {bought.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.title, { color: c.text }]}>{t('Bought')}</Text>
          {bought.map(row)}
        </View>
      ) : null}

      <Sheet
        screen
        visible={!!open}
        title={current ? t('Edit wish') : t('New wish')}
        onClose={() => setOpen(null)}
        footer={
          current ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => { archiveWish(current.id); setOpen(null); }} style={({ pressed }) => ({ flex: 1, minHeight: 48, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text style={[type.label, { color: c.expense }]}>{t('Archive')}</Text>
              </Pressable>
              <Button label={t('Save')} icon="check" onPress={save} />
            </>
          ) : (
            <>
              <Button label={t('Cancel')} variant="secondary" onPress={() => setOpen(null)} flex />
              <Button label={t('Save')} icon="check" onPress={save} flex />
            </>
          )
        }
      >
        <TextField label={t('What do you want?')} value={name} onChangeText={setName} maxLength={80} error={tried ? nameError : undefined} />
        <MoneyField label={t('Price (optional)')} cents={price} onChange={setPrice} />
        <TextField label={t('Link (optional)')} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" maxLength={500} placeholder="https://" error={tried ? urlError : undefined} />
        {url.trim() && isLink(link) ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(link)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
            <Feather name="external-link" size={18} color={c.primary} />
            <Text style={[type.label, { color: c.primary }]}>{t('Open the link')}</Text>
          </Pressable>
        ) : null}
        <TextField label={t('Note (optional)')} value={note} onChangeText={setNote} maxLength={300} />

        {live ? (
          <View style={{ gap: spacing.sm, backgroundColor: c.surface, borderRadius: radius.control, padding: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Feather name={VERDICT[live.verdict].icon} size={22} color={colorOf(VERDICT[live.verdict].tone)} />
              <Text style={[type.title, { color: colorOf(VERDICT[live.verdict].tone), flex: 1 }]}>{live.headline}</Text>
            </View>
            {live.reasons.map((r, k) => (
              <View key={k} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
                <Feather name={r.tone === 'good' ? 'check' : r.tone === 'bad' ? 'alert-triangle' : 'info'} size={18} color={r.tone === 'good' ? c.income : r.tone === 'bad' ? c.expense : c.textMuted} style={{ marginTop: 3 }} />
                <Text style={[type.body, { color: c.text, flex: 1 }]}>{r.text}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {current && !current.boughtAt ? (
          <Button label={t('I bought it')} icon="shopping-bag" variant="secondary" onPress={() => { const it = { ...current, name: name.trim() || current.name, price: price > 0 ? price : current.price }; setOpen(null); onClose(); onBought(it); }} />
        ) : null}
      </Sheet>
    </Sheet>
  );
}
