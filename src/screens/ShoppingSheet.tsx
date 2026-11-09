import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { TextField } from '../components/Fields';
import { AnimatedBar } from '../components/Motion';
import { Sheet } from '../components/Sheet';
import { newId } from '../domain/money';
import { shortDate } from '../domain/dates';
import { t } from '../i18n';
import { useStore } from '../store';
import { radius, spacing, type, useColors } from '../theme';
import { ShoppingList } from '../types';

const live = (l: ShoppingList) => l.items.filter((i) => !i.archivedAt);

/** A fresh copy of a list: same items, none checked. Nothing about the original changes. */
const templateOf = (l: ShoppingList) => ({
  name: t('{name} (copy)', { name: l.name }),
  items: live(l).map((i) => ({ id: newId(), name: i.name, done: false })),
});

/**
 * Shopping lists for the supermarket: make a list, check things off while shopping and, when done, finish it: that opens
 * the groceries bill for today, pending, to put the amount on. Any earlier list can be the template of a new one.
 */
export function ShoppingSheet({ visible, onClose, onFinish }: { visible: boolean; onClose: () => void; onFinish: (list: ShoppingList) => void }) {
  const c = useColors();
  const { data, saveShoppingList, archiveShoppingList } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const lists = data.shoppingLists;
  const current = lists.find((l) => l.id === openId) ?? null;
  const active = lists.filter((l) => !l.finishedAt);
  const finished = lists.filter((l) => l.finishedAt).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  const create = (base?: ShoppingList) => {
    const id = saveShoppingList(base ? templateOf(base) : { name: t('Shopping list'), items: [] });
    setDraft('');
    setOpenId(id);
  };

  const update = (l: ShoppingList, patch: Partial<ShoppingList>) => saveShoppingList({ ...l, ...patch });
  const addItem = (l: ShoppingList) => {
    const name = draft.trim();
    if (!name) return;
    update(l, { items: [...l.items, { id: newId(), name, done: false }] });
    setDraft('');
  };
  const toggle = (l: ShoppingList, id: string) => update(l, { items: l.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) });
  const remove = (l: ShoppingList, id: string) => update(l, { items: l.items.map((i) => (i.id === id ? { ...i, archivedAt: Date.now() } : i)) });

  const row = (l: ShoppingList) => {
    const items = live(l);
    const done = items.filter((i) => i.done).length;
    return (
      <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: radius.control, minHeight: 64 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Open {title}', { title: l.name })} onPress={() => setOpenId(l.id)} style={({ pressed }) => ({ flex: 1, minWidth: 0, padding: spacing.md, paddingLeft: spacing.lg, opacity: pressed ? 0.7 : 1 })}>
          <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{l.name}</Text>
          <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>
            {l.finishedAt ? t('{done} of {total} items · bought {date}', { done, total: items.length, date: shortDate(l.finishedAt, true) }) : t('{done} of {total} items', { done, total: items.length })}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Use as template')} onPress={() => create(l)} style={({ pressed }) => ({ minHeight: 44, minWidth: 44, paddingHorizontal: spacing.md, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <Feather name="copy" size={20} color={c.primary} />
        </Pressable>
      </View>
    );
  };

  const items = current ? live(current) : [];
  const ordered = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <Sheet screen visible={visible} title={t('Shopping lists')} onClose={onClose} footer={<Button label={t('New list')} icon="plus" onPress={() => create()} flex />}>
      <Text style={[type.body, { color: c.textMuted }]}>{t('Make a list for the supermarket, check things off while you shop and finish it to add the groceries bill. Reuse an old list as the template of a new one.')}</Text>
      {lists.length === 0 ? <Text style={[type.body, { color: c.text }]}>{t('No lists yet.')}</Text> : null}
      {active.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.title, { color: c.text }]}>{t('In progress')}</Text>
          {active.map(row)}
        </View>
      ) : null}
      {finished.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.title, { color: c.text }]}>{t('Earlier lists')}</Text>
          {finished.map(row)}
        </View>
      ) : null}

      <Sheet
        screen
        visible={!!current}
        title={current?.name ?? ''}
        onClose={() => { setOpenId(null); setDraft(''); }}
        footer={
          current && !current.finishedAt ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => { archiveShoppingList(current.id); setOpenId(null); }} style={({ pressed }) => ({ flex: 1, minHeight: 48, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text style={[type.label, { color: c.expense }]}>{t('Archive')}</Text>
              </Pressable>
              <Button label={t('Finish shopping')} icon="check" onPress={() => { const l = current; setOpenId(null); onClose(); onFinish(l); }} />
            </>
          ) : current ? (
            <Button label={t('Use as template')} icon="copy" onPress={() => create(current)} flex />
          ) : undefined
        }
      >
        {current ? (
          <View style={{ gap: spacing.lg }}>
            {!current.finishedAt ? <TextField label={t('List name')} value={current.name} onChangeText={(name) => update(current, { name })} maxLength={60} /> : null}
            {items.length > 0 ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={[type.body, { color: c.textMuted }]}>{t('{done} of {total} items', { done: doneCount, total: items.length })}</Text>
                <AnimatedBar ratio={items.length ? doneCount / items.length : 0} color={c.primary} />
              </View>
            ) : null}
            <View style={{ gap: spacing.xs }}>
              {ordered.map((i) => (
                <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, backgroundColor: c.surface, borderRadius: radius.control }}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: i.done }}
                    disabled={!!current.finishedAt}
                    onPress={() => toggle(current, i.id)}
                    style={({ pressed }) => ({ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, minHeight: 52, opacity: pressed ? 0.7 : 1 })}
                  >
                    <Feather name={i.done ? 'check-circle' : 'circle'} size={24} color={i.done ? c.primary : c.textMuted} />
                    <Text style={[type.body, { color: i.done ? c.textMuted : c.text, flex: 1, textDecorationLine: i.done ? 'line-through' : 'none' }]}>{i.name}</Text>
                  </Pressable>
                  {!current.finishedAt ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('Remove {name}', { name: i.name })} onPress={() => remove(current, i.id)} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                      <Feather name="x" size={20} color={c.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {items.length === 0 ? <Text style={[type.body, { color: c.textMuted }]}>{t('No items yet. Add the first one below.')}</Text> : null}
            </View>
            {!current.finishedAt ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <TextField label={t('Add an item')} value={draft} onChangeText={setDraft} placeholder={t('e.g. Rice')} maxLength={80} onSubmitEditing={() => addItem(current)} returnKeyType="done" blurOnSubmit={false} />
                </View>
                <Button label={t('Add')} icon="plus" variant="secondary" onPress={() => addItem(current)} disabled={!draft.trim()} />
              </View>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Sheet>
  );
}
