import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { currentMonthKey } from './src/domain/dates';
import { useAuth } from './src/firebase/useAuth';
import { LoginScreen, Splash } from './src/screens/AuthScreens';
import { CardsSheet } from './src/screens/CardsSheet';
import { CategoriesSheet } from './src/screens/CategoriesSheet';
import { Dashboard } from './src/screens/Dashboard';
import { FormPreset, TransactionForm } from './src/screens/TransactionForm';
import { BottomBar, MobileTab } from './src/components/BottomBar';
import { Brand } from './src/components/Brand';
import { HelpProvider } from './src/components/HelpTip';
import { Reveal } from './src/components/Reveal';
import { Skeleton } from './src/components/Motion';
import { StoreProvider, useStore } from './src/store';
import { Transaction } from './src/types';
import { desktopBreakpoint, maxContentWidth, minTouch, radius, spacing, type, useColors } from './src/theme';

function Shell({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const c = useColors();
  const { ready, syncError } = useStore();
  const { width } = useWindowDimensions();
  const desktop = width >= desktopBreakpoint;
  const [month, setMonth] = useState(currentMonthKey());
  /** mobile: active tab (summary, projection or transactions), in the floating bottom bar */
  const [tab, setTab] = useState<MobileTab>('summary');
  const [cardsOpen, setCardsOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [editingMonth, setEditingMonth] = useState<string | undefined>();
  const [preset, setPreset] = useState<FormPreset | undefined>();
  const name = email.split('@')[0] || 'Account';

  // web: the browser's top area (notch, status bar) follows the light top bar while signed in
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevMeta = meta?.getAttribute('content') ?? null;
    const prevBg = document.documentElement.style.backgroundColor;
    meta?.setAttribute('content', c.card);
    document.documentElement.style.backgroundColor = c.card;
    return () => {
      if (prevMeta) meta?.setAttribute('content', prevMeta);
      document.documentElement.style.backgroundColor = prevBg;
    };
  }, [c.card]);

  const avatar = (
    <View style={[s.avatar, { backgroundColor: c.surfaceAlt }]}>
      <Text style={[type.label, { color: c.primary }]}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <StatusBar style="dark" />
      {/* fixed top bar: brand, cards, avatar and sign out */}
      <Reveal distance={-12} duration={320}>
      <View style={[s.topBar, { backgroundColor: c.card, borderBottomColor: c.border }]}>
        {desktop ? (
          <View style={s.topInner}>
            <View style={s.brandRow}>
              <Brand size={22} color={c.text} />
            </View>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cards"
              onPress={() => setCardsOpen(true)}
              style={({ pressed, hovered }: any) => [s.topBtn, { backgroundColor: hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="credit-card" size={20} color={c.textMuted} />
              <Text style={[type.label, { color: c.textMuted }]}>Cards</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Categories"
              onPress={() => setCategoriesOpen(true)}
              style={({ pressed, hovered }: any) => [s.topBtn, { backgroundColor: hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }]}
            >
              <Feather name="tag" size={20} color={c.textMuted} />
              <Text style={[type.label, { color: c.textMuted }]}>Categories</Text>
            </Pressable>
            {avatar}
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onSignOut} style={({ pressed, hovered }: any) => [s.iconBtn, { backgroundColor: hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
              <Feather name="log-out" size={20} color={c.textMuted} />
            </Pressable>
          </View>
        ) : (
          // mobile: avatar with greeting on the left and sign out on the right (cards is a bottom bar tab)
          <View style={s.topInner}>
            {avatar}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.label, { color: c.text, lineHeight: 22 }]} numberOfLines={1}>{name}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Categories" onPress={() => setCategoriesOpen(true)} style={({ pressed }: any) => [s.iconBtn, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name="tag" size={20} color={c.textMuted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onSignOut} style={({ pressed }: any) => [s.iconBtn, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name="log-out" size={20} color={c.textMuted} />
            </Pressable>
          </View>
        )}
      </View>
      </Reveal>
      <ScrollView contentContainerStyle={[s.content, desktop ? { padding: spacing.xxl } : { paddingTop: spacing.lg, paddingBottom: 120 }]}>
        <View style={s.inner}>
          {syncError ? (
            <View style={[s.banner, { borderColor: c.expense }]}>
              <Text style={[type.body, { color: c.expense }]}>{syncError}</Text>
            </View>
          ) : null}
          {!ready ? (
            <View style={{ gap: spacing.lg }}>
              <Skeleton height={300} />
              <Skeleton height={220} />
            </View>
          ) : null}
          {ready ? (
            <Dashboard
              mobile={!desktop}
              mobileTab={tab}
              month={month}
              onMonthChange={setMonth}
              onOpenCards={() => (desktop ? setCardsOpen(true) : setTab('cards'))}
              onPayInvoice={(p) => {
                setEditing(undefined);
                setPreset(p);
                setFormOpen(true);
              }}
              onAdd={(p) => {
                setEditing(undefined);
                setPreset(p);
                setFormOpen(true);
              }}
              onEdit={(tx, m) => {
                setPreset(undefined);
                setEditing(tx);
                setEditingMonth(m);
                setFormOpen(true);
              }}
            />
          ) : null}
        </View>
      </ScrollView>
      {!desktop && ready && (
        <BottomBar
          tab={tab}
          onChange={setTab}
          onAdd={() => {
            setEditing(undefined);
            setPreset(undefined);
            setFormOpen(true);
          }}
        />
      )}
      <CardsSheet visible={cardsOpen} onClose={() => setCardsOpen(false)} />
      <CategoriesSheet visible={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
      <TransactionForm visible={formOpen} transaction={editing} occurrenceMonth={editingMonth} preset={preset} onClose={() => setFormOpen(false)} />
    </View>
  );
}

export default function App() {
  const { state, signIn, signUp, signOut, resetPassword, signInWithGoogle, checkEmail } = useAuth();
  if (state.status === 'loading') return <Splash />;
  if (state.status === 'out') return <LoginScreen onSignIn={signIn} onSignUp={signUp} onReset={resetPassword} onGoogle={signInWithGoogle} onCheckEmail={checkEmail} />;
  return (
    <StoreProvider uid={state.uid}>
      <HelpProvider>
        <Shell email={state.email} onSignOut={signOut} />
      </HelpProvider>
    </StoreProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  /** fixed top bar (outside the scroll), navy blue */
  topBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderBottomWidth: 1 },
  topInner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topBtn: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: 'rgba(15,27,51,0.10)' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  banner: { borderWidth: 1, borderRadius: radius.control, padding: spacing.md, marginBottom: spacing.lg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  inner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
});
