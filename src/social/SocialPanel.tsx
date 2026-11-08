import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { PillToggle } from '../components/Controls';
import { desktopBreakpoint, glow, radius, spacing, type, useColors } from '../theme';
import { motion, useReducedMotion } from '../theme/motion';
import { ChatsList, PeopleTab } from './Lists';
import { ProfileForm } from './ProfileForm';
import { ProfileView } from './ProfileView';
import { useSocial } from './SocialProvider';
import { Thread } from './Thread';
import { Avatar } from './parts';

type Route = { name: 'home' } | { name: 'thread'; handle: string } | { name: 'profile'; handle: string | 'me' } | { name: 'edit' };
type Tab = 'chats' | 'people';

const WIDTH = 440;

/**
 * The social side panel: a drawer on the right (full screen on the phone) with the conversations, the people I follow
 * and the profiles. It is one place with a small history: Back always goes one step up.
 */
export function SocialPanel({ visible, email, onClose }: { visible: boolean; email: string; onClose: () => void }) {
  const c = useColors();
  const { loaded, profile, conversations, following, followers, refresh, setPanelOpen } = useSocial();
  const { width } = useWindowDimensions();
  const desktop = width >= desktopBreakpoint;
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [tab, setTab] = useState<Tab>('chats');
  const route = stack[stack.length - 1];
  const go = (r: Route) => setStack((s) => [...s, r]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  /** opening a conversation from a profile replaces the profile, so Back goes where the person came from */
  const swapTo = (r: Route) => setStack((s) => [...s.slice(0, -1), r]);

  useEffect(() => {
    setPanelOpen(visible);
    if (visible) {
      setStack([{ name: 'home' }]);
      void refresh();
      setMounted(true);
      if (reduced) enter.setValue(1);
      else {
        enter.setValue(0);
        Animated.timing(enter, { toValue: 1, duration: 260, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
      }
    } else if (mounted) {
      if (reduced) {
        enter.setValue(0);
        setMounted(false);
      } else {
        Animated.timing(enter, { toValue: 0, duration: motion.fast + 40, easing: motion.ease, useNativeDriver: Platform.OS !== 'web' }).start(({ finished }) => finished && setMounted(false));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // who a thread is with: from the lists we already have
  const known = (h: string) => [...conversations.map((x) => x.with), ...following, ...followers].find((p) => p.handle === h);

  let title = 'Chat';
  let lead: React.ReactNode = null;
  if (!profile) title = 'Create your profile';
  else if (route.name === 'thread') {
    const p = known(route.handle);
    title = p?.displayName ?? `@${route.handle}`;
    lead = p ? <Avatar name={p.displayName} handle={p.handle} color={p.color} size={36} /> : null;
  } else if (route.name === 'profile') title = route.handle === 'me' ? 'Your profile' : 'Profile';
  else if (route.name === 'edit') title = 'Edit profile';
  const canGoBack = !!profile && stack.length > 1;

  const body = () => {
    if (!loaded) return null;
    if (!profile) return <ProfileForm email={email} existing={null} onDone={() => {}} />;
    switch (route.name) {
      case 'home':
        return (
          <View style={{ gap: spacing.lg }}>
            <PillToggle<Tab> stretch value={tab} onChange={setTab} options={[{ value: 'chats', label: 'Chats' }, { value: 'people', label: 'People' }]} />
            {tab === 'chats' ? <ChatsList onOpen={(handle) => go({ name: 'thread', handle })} onFind={() => setTab('people')} /> : <PeopleTab onOpen={(handle) => go({ name: 'profile', handle })} />}
          </View>
        );
      case 'profile':
        return <ProfileView handle={route.handle} onEdit={() => go({ name: 'edit' })} onMessage={(handle) => swapTo({ name: 'thread', handle })} />;
      case 'edit':
        return <ProfileForm email={email} existing={profile} onDone={back} />;
      default:
        return null;
    }
  };

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={[StyleSheet.absoluteFill, Platform.OS === 'web' && ({ cursor: 'default' } as object)]} onPress={onClose}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: enter }, Platform.OS === 'web' && ({ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } as object)]} />
        </Pressable>
        <Animated.View
          style={[
            s.drawer,
            desktop ? { width: WIDTH, top: spacing.md, bottom: spacing.md, right: spacing.md, borderRadius: radius.card } : { left: 0, right: 0, top: spacing.xl, bottom: 0, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
            glow('#1E2950', 40, 0.5),
            { backgroundColor: c.card, opacity: enter, transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [desktop ? 48 : 0, 0] }) }, { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [desktop ? 0 : 40, 0] }) }] },
          ]}
        >
          <View style={[s.header, { borderBottomColor: c.border }]}>
            {canGoBack ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={s.iconBtn}>
                <Feather name="arrow-left" size={22} color={c.text} />
              </Pressable>
            ) : null}
            {lead}
            <Pressable
              disabled={route.name !== 'thread'}
              onPress={() => route.name === 'thread' && swapTo({ name: 'profile', handle: route.handle })}
              style={{ flex: 1, minWidth: 0, paddingLeft: canGoBack || lead ? 0 : spacing.sm }}
              accessibilityRole={route.name === 'thread' ? 'button' : undefined}
            >
              <Text style={[type.title, { color: c.text }]} numberOfLines={1}>{title}</Text>
            </Pressable>
            {profile && route.name === 'home' ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => go({ name: 'profile', handle: 'me' })} style={s.iconBtn}>
                <Avatar name={profile.displayName} handle={profile.handle} color={profile.color} size={36} />
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={s.iconBtn}>
              <Feather name="x" size={22} color={c.textMuted} />
            </Pressable>
          </View>
          {profile && route.name === 'thread' ? (
            <Thread key={route.handle} handle={route.handle} />
          ) : (
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              {body()}
            </ScrollView>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  drawer: { position: 'absolute', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 64, paddingHorizontal: spacing.md, borderBottomWidth: 1 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
});
