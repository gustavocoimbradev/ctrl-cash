import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { currentMonthKey } from './src/domain/dates';
import { useAuth } from './src/firebase/useAuth';
import { LoginScreen, Splash } from './src/screens/AuthScreens';
import { CardsSheet } from './src/screens/CardsSheet';
import { CategoriesSheet } from './src/screens/CategoriesSheet';
import { Dashboard } from './src/screens/Dashboard';
import { AccountSheet } from './src/screens/AccountSheet';
import { Onboarding, markOnboardingSeen, onboardingSeen, resetOnboardingSeen } from './src/screens/Onboarding';
import { FormPreset, TransactionForm } from './src/screens/TransactionForm';
import { BottomBar, MobileTab } from './src/components/BottomBar';
import { Brand } from './src/components/Brand';
import { HelpProvider } from './src/components/HelpTip';
import { Reveal } from './src/components/Reveal';
import { Skeleton } from './src/components/Motion';
import { StoreProvider, useStore } from './src/store';
import { SocialProvider, useSocial } from './src/social/SocialProvider';
import { ChatDock } from './src/social/ChatDock';
import { PeopleSearch } from './src/social/PeopleSearch';
import { SideRail } from './src/components/SideRail';
import { ProfilePage } from './src/social/ProfilePage';
import { Transaction } from './src/types';
import { desktopBreakpoint, maxContentWidth, minTouch, radius, spacing, type, useColors } from './src/theme';

type Page = { name: 'dashboard' } | { name: 'profile'; id: string | 'me' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page the address asks for: `/` is the dashboard, `/profile/<uuid>` somebody's profile and `/profile` your own. */
function pageFromUrl(): Page {
  if (Platform.OS !== 'web') return { name: 'dashboard' };
  const m = /^\/profile(?:\/([^/]+))?\/?$/.exec(window.location.pathname);
  if (!m) return { name: 'dashboard' };
  if (!m[1]) return { name: 'profile', id: 'me' };
  return UUID.test(m[1]) ? { name: 'profile', id: m[1].toLowerCase() } : { name: 'profile', id: m[1] };
}

/** desktop: room on the left for the floating side menu; the top bar uses the same insets as the page, so both line up */
const DESKTOP_LEFT = 104;

function Shell({ uid, email, onSignOut }: { uid: string; email: string; onSignOut: () => void }) {
  const c = useColors();
  const { ready, syncError, data } = useStore();
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
  // first access (nothing registered yet): the setup opens by itself and keeps coming back, on every visit, until it is
  // finished. Closing it only hides it for this visit; finishing it (even with nothing added) is what ends it.
  const [seen, setSeen] = useState(() => onboardingSeen(uid));
  const [hidden, setHidden] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /** the page on screen: the dashboard, or a profile (yours or somebody else's) */
  const [page, setPage] = useState<Page>(pageFromUrl);
  const { profile: myProfile } = useSocial();
  const myId = myProfile?.id;
  const urlSynced = useRef(false);
  const toDashboard = () => setPage({ name: 'dashboard' });

  // the address follows the page (a profile is /profile/<its uuid>) and the browser's Back and Forward follow the address
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const target = page.name === 'dashboard' ? '/' : page.id === 'me' ? (myId ? `/profile/${myId}` : '/profile') : `/profile/${page.id}`;
    if (window.location.pathname !== target) {
      // the first sync and the "me" shortcut replace the entry, so Back does not land on an address that redirects
      if (!urlSynced.current || page.name === 'profile' && page.id === 'me') window.history.replaceState(null, '', target);
      else window.history.pushState(null, '', target);
    }
    urlSynced.current = true;
  }, [page, myId]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onPop = () => setPage(pageFromUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [setupRun, setSetupRun] = useState(0);
  const fresh = data.transactions.length === 0 && data.cards.length === 0 && data.reserves.length === 0;
  const finishOnboarding = () => {
    markOnboardingSeen(uid);
    setSeen(true);
  };

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
    <Pressable accessibilityRole="button" accessibilityLabel="Account settings" onPress={() => setAccountOpen(true)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <View style={[s.avatar, { backgroundColor: c.surfaceAlt }]}>
        <Text style={[type.label, { color: c.primary }]}>{name.charAt(0).toUpperCase()}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <StatusBar style="dark" />
      {/* fixed top bar: brand, cards, avatar and sign out */}
      <Reveal distance={-12} duration={320} style={{ zIndex: 10 }}>
      <View style={[s.topBar, { backgroundColor: c.card, borderBottomColor: c.border }, desktop && { paddingLeft: DESKTOP_LEFT, paddingRight: spacing.xxl }]}>
        {desktop ? (
          <View style={s.topInner}>
            <View style={s.topSide}>
              <Pressable accessibilityRole="button" accessibilityLabel="Dashboard" onPress={toDashboard} style={s.brandRow}>
                <Brand size={18} color={c.text} />
              </Pressable>
            </View>
            {/* people search, centered in the header */}
            <View style={s.topCenter}>
              <PeopleSearch onOpenProfile={(h) => setPage({ name: 'profile', id: h })} />
            </View>
            <View style={[s.topSide, { justifyContent: 'flex-end' }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onSignOut} style={({ pressed, hovered }: any) => [s.iconBtn, { backgroundColor: hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
                <Feather name="log-out" size={20} color={c.textMuted} />
              </Pressable>
            </View>
          </View>
        ) : (
          // mobile: avatar with greeting on the left and sign out on the right (cards is a bottom bar tab)
          <View style={s.topInner}>
            {avatar}
            <Pressable accessibilityRole="button" accessibilityLabel="Account settings" onPress={() => setAccountOpen(true)} style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.label, { color: c.text, lineHeight: 22 }]} numberOfLines={1}>{name}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Search people" onPress={() => setSearchOpen((v) => !v)} style={({ pressed }: any) => [s.iconBtn, { backgroundColor: searchOpen ? `${c.primary}1A` : c.surface, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name="search" size={20} color={searchOpen ? c.primary : c.textMuted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Profile" onPress={() => setPage({ name: 'profile', id: 'me' })} style={({ pressed }: any) => [s.iconBtn, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name="user" size={20} color={c.textMuted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Categories" onPress={() => setCategoriesOpen(true)} style={({ pressed }: any) => [s.iconBtn, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name="tag" size={20} color={c.textMuted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onSignOut} style={({ pressed }: any) => [s.iconBtn, { backgroundColor: c.surface, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name="log-out" size={20} color={c.textMuted} />
            </Pressable>
          </View>
        )}
        {!desktop && searchOpen ? (
          <View style={s.mobileSearch}>
            <PeopleSearch autoFocus onDone={() => setSearchOpen(false)} onOpenProfile={(h) => setPage({ name: 'profile', id: h })} />
          </View>
        ) : null}
      </View>
      </Reveal>
      {desktop ? (
        <SideRail
          items={[
            { key: 'home', icon: 'home', label: 'Dashboard', onPress: toDashboard, active: page.name === 'dashboard' },
            { key: 'cards', icon: 'credit-card', label: 'Cards', onPress: () => setCardsOpen(true) },
            { key: 'categories', icon: 'tag', label: 'Categories', onPress: () => setCategoriesOpen(true) },
            { key: 'profile', icon: 'user', label: 'Profile', onPress: () => setPage({ name: 'profile', id: 'me' }), active: page.name === 'profile' && page.id === 'me' },
          ]}
        />
      ) : null}
      <ScrollView contentContainerStyle={[s.content, desktop ? { padding: spacing.xxl, paddingTop: spacing.lg, paddingLeft: DESKTOP_LEFT } : { paddingTop: spacing.lg, paddingBottom: 120 }]}>
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
          {ready && page.name === 'profile' ? (
            <ProfilePage id={page.id} email={email} onEditAccount={() => setAccountOpen(true)} onBack={toDashboard} onOpen={(h) => setPage({ name: 'profile', id: h })} />
          ) : null}
          {ready && page.name === 'dashboard' ? (
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
          onChange={(t) => { toDashboard(); setTab(t); }}
          onAdd={() => {
            setEditing(undefined);
            setPreset(undefined);
            setFormOpen(true);
          }}
        />
      )}
      <Onboarding key={setupRun} visible={ready && fresh && !seen && !hidden && !accountOpen} onClose={() => setHidden(true)} onDone={finishOnboarding} />
      <AccountSheet
        visible={accountOpen}
        email={email}
        onClose={() => setAccountOpen(false)}
        onCleared={() => {
          // a fresh account: the quick setup is owed again
          resetOnboardingSeen(uid);
          setSeen(false);
          setHidden(false);
          setSetupRun((n) => n + 1);
          setAccountOpen(false);
        }}
      />
      {ready ? <ChatDock mobile={!desktop} onOpenProfile={(h) => setPage({ name: 'profile', id: h })} /> : null}
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
        <SocialProvider>
          <Shell uid={state.uid} email={state.email} onSignOut={signOut} />
        </SocialProvider>
      </HelpProvider>
    </StoreProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  /** fixed top bar (outside the scroll), navy blue */
  topBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderBottomWidth: 1 },
  topInner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
  topSide: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  topCenter: { width: '100%', maxWidth: 520, flexShrink: 1 },
  mobileSearch: { paddingBottom: spacing.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topBtn: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: 'rgba(15,27,51,0.10)' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  banner: { borderWidth: 1, borderRadius: radius.control, padding: spacing.md, marginBottom: spacing.lg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  inner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
});
