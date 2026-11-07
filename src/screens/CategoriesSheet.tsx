import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { PillToggle, ToggleRow } from '../components/Controls';
import { Field, TextField } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { Category, IMPACT_LEVELS, allCategories } from '../domain/categories';
import { useStore } from '../store';
import { colors as c, radius, spacing, type } from '../theme';

type Kind = 'expense' | 'income';

/** The impact level closest to a weight (built-in categories use finer values than the three levels). */
const nearestImpact = (weight: number) => IMPACT_LEVELS.reduce((best, l) => (Math.abs(l.value - weight) < Math.abs(best.value - weight) ? l : best), IMPACT_LEVELS[0]);

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
        Organize where your money goes. Archive a category you no longer use: it disappears from new transactions, and everything already recorded keeps it.
      </Text>
      <PillToggle<Kind>
        stretch
        value={kind}
        onChange={onKind}
        options={[
          { value: 'expense', label: 'Expenses' },
          { value: 'income', label: 'Income' },
        ]}
      />
      {list.map((cat) => (
        <Pressable
          key={`${cat.kind}-${cat.slug}`}
          accessibilityRole="button"
          accessibilityLabel={`Edit category ${cat.label}`}
          onPress={() => onEdit(cat)}
          style={({ pressed, hovered }: any) => [s.row, { backgroundColor: hovered ? c.surfaceAlt : c.surface, opacity: pressed ? 0.7 : cat.archived ? 0.6 : 1 }]}
        >
          <View style={s.tile}>
            <Feather name="tag" size={18} color={c.primary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{cat.label}{cat.archived ? '  ·  archived' : ''}</Text>
            <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>
              {[cat.kind === 'expense' ? `${nearestImpact(cat.weight).label} impact` : null, cat.custom ? 'Yours' : 'Built in'].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Feather name="edit-2" size={16} color={c.textMuted} />
        </Pressable>
      ))}
      {hasArchived && <ToggleRow label="Show archived" hint="Restore one from its edit screen." value={showArchived} onChange={setShowArchived} />}
    </>
  );
}

/** Category management in a dialog; the New category button is pinned in the footer, like the header. */
export function CategoriesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('expense');
  const [form, setForm] = useState<{ category?: Category } | null>(null);
  return (
    <Sheet visible={visible} title="Categories" onClose={onClose} footer={<Button label="New category" icon="plus" onPress={() => setForm({})} flex />}>
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
  const [tried, setTried] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setKind(category?.kind ?? listKind);
    setName(category?.label ?? '');
    setImpact(category ? nearestImpact(category.weight).value : IMPACT_LEVELS[1].value);
    setImpactTouched(false);
    setTried(false);
    setConfirmArchive(false);
  }, [visible, category]);

  const clash = allCategories(kind).some((x) => x.label.trim().toLowerCase() === name.trim().toLowerCase() && x.slug !== category?.slug);
  const nameError = !name.trim() ? 'Enter the category name' : clash ? 'A category with this name already exists' : undefined;

  const submit = () => {
    setTried(true);
    if (nameError) return;
    saveCategory({
      kind,
      slug: category?.slug,
      name,
      // an existing category keeps its exact impact unless the person picked another level
      weight: kind === 'expense' ? (category && !impactTouched ? category.weight : impact) : undefined,
    });
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={category ? 'Edit category' : 'New category'}
      onClose={onClose}
      footer={
        category ? (
          <>
            {category.system ? (
              <View style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
                <Text style={[type.body, { color: c.textMuted }]}>The app relies on this one: it cannot be archived.</Text>
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
                <Text style={[type.label, { color: category.archived ? c.primary : c.expense }]}>{category.archived ? 'Restore' : 'Archive'}</Text>
              </Pressable>
            )}
            <Button label="Save" icon="check" onPress={submit} />
          </>
        ) : (
          <>
            <Button label="Cancel" variant="secondary" onPress={onClose} flex />
            <Button label="Save" icon="check" onPress={submit} flex />
          </>
        )
      }
    >
      {!category && (
        <Field label="Type">
          <PillToggle<Kind>
            stretch
            value={kind}
            onChange={setKind}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
            ]}
          />
        </Field>
      )}
      <TextField label="Name" value={name} onChangeText={setName} maxLength={40} error={tried ? nameError : undefined} />
      {kind === 'expense' && (
        <Field label="Impact on financial health">
          <PillToggle<number>
            stretch
            value={category && !impactTouched ? nearestImpact(category.weight).value : impact}
            onChange={(v) => {
              setImpact(v);
              setImpactTouched(true);
            }}
            options={IMPACT_LEVELS.map((l) => ({ value: l.value, label: l.label }))}
          />
          <Text style={[type.body, { color: c.textMuted, marginTop: spacing.sm }]}>
            How much spending here counts against your financial health: essentials barely count, discretionary spending counts the most.
          </Text>
        </Field>
      )}

      <Sheet
        visible={confirmArchive}
        title="Archive category"
        onClose={() => setConfirmArchive(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setConfirmArchive(false)} flex />
            <Button
              label="Archive"
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
          "{category?.label}" stops being offered for new transactions. Everything already recorded keeps it, and you can restore it any time.
        </Text>
      </Sheet>
    </Sheet>
  );
}

const s = {
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, padding: spacing.md, borderRadius: radius.control, minHeight: 64 },
  tile: { width: 40, height: 40, borderRadius: radius.control - 2, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.card },
};
