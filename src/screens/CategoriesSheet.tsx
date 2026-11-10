import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { PillToggle, ToggleRow } from '../components/Controls';
import { Field, TextField } from '../components/Fields';
import { ByClaude } from '../components/ClaudeMark';
import { Select } from '../components/Select';
import { Sheet } from '../components/Sheet';
import { t } from '../i18n';
import { Category, IMPACT_LEVELS, TONE_LIST, allCategories, builtinBaseName, toneFromWeight, toneLabel } from '../domain/categories';
import { useStore } from '../store';
import { colors as c, radius, spacing, type } from '../theme';
import type { Tone } from '../types';

type Kind = 'expense' | 'income';

/** The impact level closest to a weight (built-in categories use finer values than the three levels). */
const nearestImpact = (weight: number) => IMPACT_LEVELS.reduce((best, l) => (Math.abs(l.value - weight) < Math.abs(best.value - weight) ? l : best), IMPACT_LEVELS[0]);

/** Translated impact level name (the constant keeps English). */
const impactLabel = (value: number) => (value === 0.1 ? t('Essential') : value === 0.45 ? t('Regular') : t('Discretionary'));
const impactText = (value: number) => (value === 0.1 ? t('Essential impact') : value === 0.45 ? t('Regular impact') : t('Discretionary impact'));

/**
 * Category management: create, rename, set the impact on financial health and archive. Nothing
 * is ever deleted: an archived category stops being offered for new transactions but the ones
 * already recorded keep it.
 */
function CategoriesList({ kind, onKind, onEdit }: { kind: Kind; onKind: (k: Kind) => void; onEdit: (category: Category) => void }) {
  const { data } = useStore(); // re-renders when the category records change
  const [showArchived, setShowArchived] = useState(false);
  const list = allCategories(kind).filter((x) => !x.archived || showArchived);
  const hasArchived = data.categories.some((r) => r.archivedAt) || allCategories(kind).some((x) => x.archived);

  return (
    <>
      <Text style={[type.body, { color: c.textMuted }]}>
        {t('Organize where your money goes. Archive a category you no longer use: it disappears from new transactions, and everything already recorded keeps it.')}
      </Text>
      <PillToggle<Kind>
        stretch
        value={kind}
        onChange={onKind}
        options={[
          { value: 'expense', label: t('Expenses') },
          { value: 'income', label: t('Income') },
        ]}
      />
      {list.map((cat) => (
        <Pressable
          key={`${cat.kind}-${cat.slug}`}
          accessibilityRole="button"
          accessibilityLabel={t('Edit category {name}', { name: cat.label })}
          onPress={() => onEdit(cat)}
          style={({ pressed, hovered }: any) => [s.row, { backgroundColor: hovered ? c.surfaceAlt : c.surface, opacity: pressed ? 0.7 : cat.archived ? 0.6 : 1 }]}
        >
          <View style={s.tile}>
            <Feather name="tag" size={18} color={c.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[type.label, { color: c.text, flexShrink: 1 }]}>{cat.archived ? t('{name}  ·  archived', { name: cat.label }) : cat.label}</Text>
              {cat.source === 'claude' ? <ByClaude /> : null}
            </View>
            <Text style={[type.body, { color: c.textMuted }]}>
              {[cat.kind === 'expense' ? impactText(nearestImpact(cat.weight).value) : null, cat.custom ? t('Yours') : t('Built in')].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Feather name="edit-2" size={16} color={c.textMuted} />
        </Pressable>
      ))}
      {hasArchived && <ToggleRow label={t('Show archived')} hint={t('Restore one from its edit screen.')} value={showArchived} onChange={setShowArchived} />}
    </>
  );
}

/** Category management in a dialog; the New category button is pinned in the footer, like the header. */
export function CategoriesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('expense');
  const [form, setForm] = useState<{ category?: Category } | null>(null);
  return (
    <Sheet screen visible={visible} title={t('Categories')} onClose={onClose} footer={<Button label={t('New category')} icon="plus" onPress={() => setForm({})} flex />}>
      <CategoriesList kind={kind} onKind={setKind} onEdit={(category) => setForm({ category })} />
      <CategoryForm visible={!!form} kind={kind} category={form?.category} onClose={() => setForm(null)} />
    </Sheet>
  );
}

function CategoryForm({ visible, kind: listKind, category, onClose }: { visible: boolean; kind: Kind; category?: Category; onClose: () => void }) {
  const { saveCategory, archiveCategory, restoreCategory } = useStore();
  const [kind, setKind] = useState<Kind>(listKind);
  const [name, setName] = useState('');
  const [impact, setImpact] = useState<number>(IMPACT_LEVELS[1].value);
  const [impactTouched, setImpactTouched] = useState(false);
  const [tone, setTone] = useState<Tone>('comfort');
  const [toneTouched, setToneTouched] = useState(false);
  const [tried, setTried] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind(category?.kind ?? listKind);
    setName(category?.label ?? '');
    setImpact(category ? nearestImpact(category.weight).value : IMPACT_LEVELS[1].value);
    setImpactTouched(false);
    setTone(category?.tone ?? toneFromWeight(category?.weight ?? IMPACT_LEVELS[1].value));
    setToneTouched(false);
    setTried(false);
    setConfirmArchive(false);
  }, [visible, category]);

  const clash = allCategories(kind).some((x) => x.label.trim().toLowerCase() === name.trim().toLowerCase() && x.slug !== category?.slug);
  const nameError = !name.trim() ? t('Enter the category name') : clash ? t('A category with this name already exists') : undefined;

  const submit = () => {
    setTried(true);
    if (nameError) return;
    saveCategory({
      kind,
      slug: category?.slug,
      // a built-in category left with its shown name keeps its English name (so it keeps following the language)
      name: category && !category.custom && name.trim() === category.label ? builtinBaseName(category.kind, category.slug) ?? name : name,
      // an existing category keeps its exact impact unless the person picked another level
      weight: kind === 'expense' ? (category && !impactTouched ? category.weight : impact) : undefined,
      // the person's pick; untouched, a new category takes the tone its impact suggests, an old one keeps what it has
      tone: kind === 'expense' ? (toneTouched ? tone : category ? undefined : toneFromWeight(impact)) : undefined,
    });
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={category ? t('Edit category') : t('New category')}
      onClose={onClose}
      footer={
        category ? (
          <>
            {category.system ? (
              <View style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
                <Text style={[type.body, { color: c.textMuted }]}>{t('The app relies on this one: it cannot be archived.')}</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (category.archived) {
                    restoreCategory(category.kind, category.slug);
                    onClose();
                  } else setConfirmArchive(true);
                }}
                style={({ pressed }) => ({ flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={[type.label, { color: category.archived ? c.primary : c.expense }]}>{category.archived ? t('Restore') : t('Archive')}</Text>
              </Pressable>
            )}
            <Button label={t('Save')} icon="check" onPress={submit} />
          </>
        ) : (
          <>
            <Button label={t('Cancel')} variant="secondary" onPress={onClose} flex />
            <Button label={t('Save')} icon="check" onPress={submit} flex />
          </>
        )
      }
    >
      {!category && (
        <Field label={t('Type')}>
          <PillToggle<Kind>
            stretch
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: t('Expense') },
              { value: 'income', label: t('Income') },
            ]}
          />
        </Field>
      )}
      <TextField label={t('Name')} value={name} onChangeText={setName} maxLength={40} error={tried ? nameError : undefined} />
      {kind === 'expense' && (
        <Field label={t('Impact on financial health')}>
          <PillToggle<number>
            stretch
            value={category && !impactTouched ? nearestImpact(category.weight).value : impact}
            onChange={(v) => {
              setImpact(v);
              setImpactTouched(true);
            }}
            options={IMPACT_LEVELS.map((l) => ({ value: l.value, label: impactLabel(l.value) }))}
          />
          <Text style={[type.body, { color: c.textMuted, marginTop: spacing.sm }]}>
            {t('How much spending here counts against your financial health: essentials barely count, discretionary spending counts the most.')}
          </Text>
        </Field>
      )}
      {kind === 'expense' && (
        <Select
          label={t('Type of spending')}
          value={toneTouched || category ? tone : toneFromWeight(impact)}
          options={TONE_LIST.map((x) => ({ value: x, label: toneLabel(x) }))}
          onChange={(v) => {
            setTone(v as Tone);
            setToneTouched(true);
          }}
        />
      )}
      {kind === 'expense' && (
        <Text style={[type.body, { color: c.textMuted }]}>{t('Shown beside the category in your shared summary: healthy, necessary, comfort, luxury, unhealthy or unknown.')}</Text>
      )}

      <Sheet
        visible={confirmArchive}
        title={t('Archive category')}
        onClose={() => setConfirmArchive(false)}
        footer={
          <>
            <Button label={t('Cancel')} variant="secondary" onPress={() => setConfirmArchive(false)} flex />
            <Button
              label={t('Archive')}
              danger
              flex
              onPress={() => {
                if (category) archiveCategory(category.kind, category.slug);
                setConfirmArchive(false);
                onClose();
              }}
            />
          </>
        }
      >
        <Text style={[type.body, { color: c.text }]}>
          {t('"{name}" stops being offered for new transactions. Everything already recorded keeps it, and you can restore it any time.', { name: category?.label ?? '' })}
        </Text>
      </Sheet>
    </Sheet>
  );
}

const s = {
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, padding: spacing.md, borderRadius: radius.control, minHeight: 64 },
  tile: { width: 40, height: 40, borderRadius: radius.control - 2, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.card },
};
