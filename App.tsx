import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { currentMonthKey } from './src/domain/dates';
import { useAuth } from './src/firebase/useAuth';
import { LoginScreen, Splash } from './src/screens/AuthScreens';
import { CardsSheet } from './src/screens/CardsSheet';
import { CategoriesSheet } from './src/screens/CategoriesSheet';
import { ShoppingSheet } from './src/screens/ShoppingSheet';
import { AreaSheet } from './src/screens/AreaSheet';
import { WishlistSheet } from './src/screens/WishlistSheet';
import { ConnectPage, ConnectParams } from './src/screens/ConnectPage';
import { AssistantSheet } from './src/screens/AssistantSheet';
import { AssistantPromo } from './src/screens/AssistantPromo';
import { CLAUDE, ClaudeMark } from './src/components/ClaudeMark';
import { AssistantProvider } from './src/assistant/AssistantProvider';
import { DebtsSheet } from './src/screens/DebtsSheet';
import type { AreaKey } from './src/domain/areas';
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
import { Avatar } from './src/social/parts';
import { MenuDrawer } from './src/components/MenuDrawer';
import { ProfilePage } from './src/social/ProfilePage';
import { PrefsProvider } from './src/store/prefs';
import { t, usePrefsVersion } from './src/i18n';
import { Transaction } from './src/types';
import { desktopBreakpoint, maxContentWidth, minTouch, radius, spacing, type, useColors } from './src/theme';

type Page = { name: 'dashboard' } | { name: 'profile'; id: string | 'me' } | { name: 'connect'; params: ConnectParams };

/** The page the address asks for: `/` is the dashboard, `/profile/<code>` somebody's profile and `/profile` your own. */
function pageFromUrl(): Page {
  if (Platform.OS !== 'web') return { name: 'dashboard' };
  // an AI assistant asked to connect: the consent page, with what the assistant sent in the address
  if (window.location.pathname === '/connect') {
    const q = new URLSearchParams(window.location.search);
    return { name: 'connect', params: { client_id: q.get('client_id') ?? undefined, redirect_uri: q.get('redirect_uri') ?? undefined, state: q.get('state') ?? undefined, code_challenge: q.get('code_challenge') ?? undefined } };
  }
  const m = /^\/profile(?:\/([^/]+))?\/?$/.exec(window.location.pathname);
  if (!m) return { name: 'dashboard' };
  if (!m[1]) return { name: 'profile', id: 'me' };
  return { name: 'profile', id: m[1].toUpperCase() };
}

function Shell({ uid, email, onSignOut }: { uid: string; email: string; onSignOut: () => void }) {
  const c = useColors();
  const { ready, syncError, data, saveShoppingList, saveWish } = useStore();
  const { width } = useWindowDimensions();
  const desktop = width >= desktopBreakpoint;
  const [month, setMonth] = useState(currentMonthKey());
  /** mobile: active tab (summary, projection or transactions), in the floating bottom bar */
  const [tab, setTab] = useState<MobileTab>('summary');
  const [cardsOpen, setCardsOpen] = useState(false);
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [wishOpen, setWishOpen] = useState(false);
  const [debtsOpen, setDebtsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [area, setArea] = useState<AreaKey | null>(null);
  const lastArea = useRef<AreaKey>('subscriptions');
  if (area) lastArea.current = area;
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | undefined>();
  const [editingMonth, setEditingMonth] = useState<string | undefined>();
  const [preset, setPreset] = useState<FormPreset | undefined>();
  const name = email.split('@')[0] || t('Account');
  // first access (nothing registered yet): the setup opens by itself and keeps coming back, on every visit, until it is
  // finished. Closing it only hides it for this visit; finishing it (even with nothing added) is what ends it.
  const [seen, setSeen] = useState(() => onboardingSeen(uid));
  const [hidden, setHidden] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** the page on screen: the dashboard, or a profile (yours or somebody else's) */
  const [page, setPage] = useState<Page>(pageFromUrl);
  const { profile: myProfile, unread, openChat } = useSocial();
  const myId = myProfile?.code;
  const urlSynced = useRef(false);
  const toDashboard = () => setPage({ name: 'dashboard' });
  /** the places beside Cards and Categories, in the phone menu and in the strip above the projection */
  const places = [
    // Shopping lists and Wishlist are built (ShoppingSheet, WishlistSheet) but switched off for now: to bring them back, add
    // { key: 'shopping', icon: 'shopping-cart', label: t('Shopping lists'), onPress: () => setShoppingOpen(true) } and
    // { key: 'wishlist', icon: 'gift', label: t('Wishlist'), onPress: () => setWishOpen(true) } here.
    { key: 'debts', icon: 'layers' as const, label: t('Debts'), onPress: () => setDebtsOpen(true) },
    { key: 'subscriptions', icon: 'repeat' as const, label: t('Subscriptions'), onPress: () => setArea('subscriptions') },
    { key: 'bills', icon: 'file-text' as const, label: t('Utility bills'), onPress: () => setArea('bills') },
    { key: 'delivery', icon: 'package' as const, label: t('Delivery'), onPress: () => setArea('delivery') },
    // Claude: highlighted, so it is plain that it can be connected
    { key: 'claude', icon: 'message-circle' as const, label: t('Ask Claude'), onPress: () => setAssistantOpen(true), accent: true, iconNode: <ClaudeMark size={20} /> },
  ];

  // the address follows the page (a profile is /profile/<its code>) and the browser's Back and Forward follow the address
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // the consent page keeps its address (and what is in it) until the person decides
    if (page.name === 'connect') return;
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

  return (
    <View style={[s.root, { backgroundColor: c.bg }]}>
      <StatusBar style="dark" />
      {/* fixed top bar: brand, cards, avatar and sign out */}
      <Reveal distance={-12} duration={320} style={{ zIndex: 10 }}>
      <View style={[s.topBar, { backgroundColor: c.card, borderBottomColor: c.border }, desktop && { paddingHorizontal: spacing.xxl }]}>
        {desktop ? (
          <View style={s.topInner}>
            <View style={[s.topSide, { flex: 0 }]}>
              {/* a real link to the root: it opens in a new tab with a middle click, and a plain click stays in the app */}
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('Dashboard')}
                {...(Platform.OS === 'web' ? ({ href: '/' } as object) : {})}
                onPress={(e: any) => {
                  e?.preventDefault?.();
                  toDashboard();
                }}
                style={[s.brandRow, Platform.OS === 'web' && ({ cursor: 'pointer' } as object)]}
              >
                <Brand size={18} color={c.text} inLink />
              </Pressable>
            </View>
            {/* the places (cards, categories, debts...): a quiet navigation in the header, always at hand */}
            <View style={s.nav} accessibilityRole="menu">
              {[
                { key: 'cards', icon: 'credit-card' as const, label: t('Cards'), onPress: () => setCardsOpen(true) },
                { key: 'categories', icon: 'tag' as const, label: t('Categories'), onPress: () => setCategoriesOpen(true) },
                ...places,
              ].map((it) => (
                <Pressable
                  key={it.key}
                  accessibilityRole="menuitem"
                  accessibilityLabel={it.label}
                  onPress={it.onPress}
                  style={({ pressed, hovered }: any) => [s.navItem, { backgroundColor: hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }, Platform.OS === 'web' && ({ transitionProperty: 'background-color', transitionDuration: '140ms' } as object)]}
                >
                  {({ hovered }: any) => (
                    <>
                      {'iconNode' in it && it.iconNode ? <ClaudeMark size={18} /> : <Feather name={it.icon} size={18} color={hovered ? c.text : c.textMuted} />}
                      <Text style={[type.label, { color: 'accent' in it && it.accent ? CLAUDE.orangeDark : hovered ? c.text : c.textMuted }]} numberOfLines={1}>{it.label}</Text>
                    </>
                  )}
                </Pressable>
              ))}
            </View>
            <View style={[s.topSide, { flex: 0, justifyContent: 'flex-end' }]}>
              {/* my profile: the avatar (it is not highlighted on the profile page) */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('My profile')}
                onPress={() => setPage({ name: 'profile', id: 'me' })}
                style={({ pressed, hovered }: any) => [s.avatarBtn, { borderColor: hovered ? c.surfaceAlt : 'transparent', opacity: pressed ? 0.7 : 1 }]}
              >
                <Avatar name={myProfile?.displayName ?? name} id={myProfile?.code ?? 'me'} color={myProfile?.color} photo={myProfile?.photo} size={36} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('Sign out')} onPress={onSignOut} style={({ pressed, hovered }: any) => [s.iconBtn, { backgroundColor: hovered ? c.surface : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
                <Feather name="log-out" size={20} color={c.textMuted} />
              </Pressable>
            </View>
          </View>
        ) : (
          // phone: the menu on the left (a panel with what is not on the bottom bar) and the chat on the right
          <View style={s.topInner}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Open menu')} onPress={() => setMenuOpen(true)} style={({ pressed }: any) => [s.iconBtn, { backgroundColor: pressed ? c.surface : 'transparent' }]}>
              <Feather name="menu" size={24} color={c.text} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={unread > 0 ? t('Messages, {count} unread', { count: unread }) : t('Messages')}
              onPress={() => openChat()}
              style={({ pressed }: any) => [s.iconBtn, { backgroundColor: pressed ? c.surface : 'transparent' }]}
            >
              <Feather name="heart" size={24} color={c.text} />
              {unread > 0 ? (
                <View style={[s.badge, { backgroundColor: c.expense, borderColor: c.card }]}>
                  <Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        )}
      </View>
      </Reveal>
      <ScrollView contentContainerStyle={[s.content, desktop ? { padding: spacing.xxl, paddingTop: spacing.lg } : { paddingTop: spacing.lg, paddingBottom: 120 }]}>
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
          {ready && page.name === 'dashboard' ? <AssistantPromo /> : null}
          {ready && page.name === 'connect' ? (
            <ConnectPage params={page.params} onBack={() => { if (Platform.OS === 'web') window.history.replaceState(null, '', '/'); setPage({ name: 'dashboard' }); }} />
          ) : null}
          {ready && page.name === 'profile' ? (
            <ProfilePage id={page.id} email={email} onEditAccount={() => setAccountOpen(true)} onOpen={(h) => setPage({ name: 'profile', id: h })} />
          ) : null}
          {ready && page.name === 'dashboard' ? (
            <Dashboard
              mobile={!desktop}
              mobileTab={tab}
              month={month}
              onMonthChange={setMonth}
              onOpenCards={() => setCardsOpen(true)}
              onOpenCategories={() => setCategoriesOpen(true)}
              places={places}
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
          tab={page.name === 'dashboard' ? tab : null}
          onChange={(t) => { toDashboard(); setTab(t); }}
          onAdd={() => {
            setEditing(undefined);
            setPreset(undefined);
            setFormOpen(true);
          }}
          onProfile={() => setPage({ name: 'profile', id: 'me' })}
          avatar={<Avatar name={myProfile?.displayName ?? name} id={myProfile?.code ?? 'me'} color={myProfile?.color} photo={myProfile?.photo} size={34} />}
        />
      )}
      <Onboarding key={setupRun} visible={ready && fresh && !seen && !hidden && !accountOpen} onClose={() => setHidden(true)} onDone={finishOnboarding} />
      <AccountSheet
        visible={accountOpen}
        email={email}
        onClose={() => setAccountOpen(false)}
        onOpenAssistant={() => { setAccountOpen(false); setAssistantOpen(true); }}
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
      <MenuDrawer
        side="left"
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        header={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Avatar name={myProfile?.displayName ?? name} id={myProfile?.code ?? 'me'} color={myProfile?.color} photo={myProfile?.photo} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{myProfile?.displayName ?? name}</Text>
              {myProfile ? <Text style={[type.body, { color: c.textMuted, letterSpacing: 2 }]}>{myProfile.code}</Text> : null}
            </View>
          </View>
        }
        items={[
          { key: 'cards', icon: 'credit-card', label: t('Cards'), onPress: () => setCardsOpen(true) },
          { key: 'categories', icon: 'tag', label: t('Categories'), onPress: () => setCategoriesOpen(true) },
          ...places,
          { key: 'account', icon: 'settings', label: t('Account settings'), onPress: () => setAccountOpen(true) },
          { key: 'out', icon: 'log-out', label: t('Sign out'), onPress: onSignOut, danger: true },
        ]}
      />
      <CardsSheet visible={cardsOpen} onClose={() => setCardsOpen(false)} />
      <CategoriesSheet visible={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
      <WishlistSheet
        visible={wishOpen}
        onClose={() => setWishOpen(false)}
        onBought={(item) => {
          // bought it: the expense opens with what was on the list, and the wish is marked bought once it is saved
          setEditing(undefined);
          setPreset({ kind: 'expense', description: item.name, amount: item.price, onSaved: () => saveWish({ ...item, boughtAt: Date.now() }) });
          setFormOpen(true);
        }}
      />
      <AssistantSheet visible={assistantOpen} onClose={() => setAssistantOpen(false)} />
      <DebtsSheet
        visible={debtsOpen}
        onClose={() => setDebtsOpen(false)}
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
      <AreaSheet
        area={lastArea.current}
        visible={area !== null}
        onClose={() => setArea(null)}
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
      <ShoppingSheet
        visible={shoppingOpen}
        onClose={() => setShoppingOpen(false)}
        onFinish={(list) => {
          // shopping is over: the groceries bill of today opens, pending, to put the amount on; the list is marked finished once it is saved
          setEditing(undefined);
          setPreset({
            kind: 'expense',
            description: t('Groceries'),
            category: 'groceries',
            confirmed: false,
            onSaved: () => saveShoppingList({ ...list, finishedAt: Date.now() }),
          });
          setFormOpen(true);
        }}
      />
      <TransactionForm visible={formOpen} transaction={editing} occurrenceMonth={editingMonth} preset={preset} onClose={() => setFormOpen(false)} />
    </View>
  );
}

export default function App() {
  // the language or currency changed: render everything again, so each `t()` and `formatMoney()` reads the new one
  usePrefsVersion();
  const { state, signIn, signUp, signOut, resetPassword, signInWithGoogle, checkEmail } = useAuth();
  if (state.status === 'loading') return <Splash />;
  if (state.status === 'out') return <LoginScreen onSignIn={signIn} onSignUp={signUp} onReset={resetPassword} onGoogle={signInWithGoogle} onCheckEmail={checkEmail} />;
  return (
    <StoreProvider uid={state.uid}>
      <PrefsProvider>
        <AssistantProvider>
          <HelpProvider>
            <SocialProvider account={{ email: state.email, name: state.name }}>
              <Shell uid={state.uid} email={state.email} onSignOut={signOut} />
            </SocialProvider>
          </HelpProvider>
        </AssistantProvider>
      </PrefsProvider>
    </StoreProvider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  /** fixed top bar (outside the scroll), navy blue */
  topBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, borderBottomWidth: 1 },
  topInner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
  topSide: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  /** the places in the header: icon and label, no frame, a soft background on hover */
  nav: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, flexWrap: 'nowrap' },
  navItem: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1, minWidth: 0 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  topBtn: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: 'rgba(15,27,51,0.10)' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 2, right: 0, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 12, lineHeight: 14, fontWeight: '700' },
  avatarBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  banner: { borderWidth: 1, borderRadius: radius.control, padding: spacing.md, marginBottom: spacing.lg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  inner: { width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' },
});
