import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { desktopBreakpoint, glow, radius, spacing, type, useColors } from '../theme';
import { motion, useReducedMotion } from '../theme/motion';
import { ChatsList } from './Lists';
import { useSocial } from './SocialProvider';
import { Thread } from './Thread';
import { People } from './People';
import { Person, socialApi } from './api';
import { Avatar, Pill } from './parts';
import { t } from '../i18n';

const WIDTH = 380;
const HEIGHT = 560;

/**
 * The floating chat, bottom right: a quiet "Messages" pill that opens into a small window (the page behind stays usable).
 * It lists the conversations and the people, and shows one conversation at a time. Profiles are pages, so tapping a
 * person goes there. On the phone the pill sits above the bottom bar and the window takes the whole screen.
 */
export function ChatDock({ mobile, onOpenProfile }: { mobile: boolean; onOpenProfile: (id: string | 'me') => void }) {
  const c = useColors();
  const { loaded, profile, conversations, given, received, unread, chat, openChat, closeChat, chatList, refresh } = useSocial();
  /** starting a conversation: type the other person's code, see who it is, confirm */
  const [composing, setComposing] = useState(false);
  /** the person of a conversation that is not in the lists yet (no message sent so far) */
  const [fetched, setFetched] = useState<Person | null>(null);
  const { height: winH } = useWindowDimensions();
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(chat.open);

  useEffect(() => {
    if (chat.open) {
      void refresh();
      setMounted(true);
      if (reduced) enter.setValue(1);
      else {
        enter.setValue(0);
        Animated.timing(enter, { toValue: 1, duration: 240, easing: motion.easeOut, useNativeDriver: Platform.OS !== 'web' }).start();
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
  }, [chat.open]);

  const known = chat.with ? [...conversations.map((x) => x.with), ...given, ...received].find((p) => p.code === chat.with) : undefined;
  const peer = known ?? (fetched && fetched.code === chat.with ? fetched : undefined);
  useEffect(() => {
    if (chat.with && !known && fetched?.code !== chat.with) socialApi.person(chat.with).then((r) => setFetched(r.person)).catch(() => {});
  }, [chat.with, known, fetched?.code]);
  useEffect(() => {
    if (!chat.open) setComposing(false);
  }, [chat.open]);
  const latest = conversations[0]?.with;
  const place = mobile ? { right: spacing.lg, bottom: 88 } : { right: spacing.xl, bottom: spacing.xl };
  const height = Math.min(HEIGHT, winH - 96);

  const body = () => {
    if (!loaded) return null;
    if (!profile) {
      return (
        <View style={s.cta}>
          <View style={[s.ctaIcon, { backgroundColor: c.surface }]}>
            <Feather name="users" size={24} color={c.primary} />
          </View>
          <Text style={[type.label, { color: c.text, textAlign: 'center' }]}>{t('Chat with people you follow')}</Text>
          <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>{t('Create your profile to follow people and send messages. Nothing about your money is shown unless you share it.')}</Text>
          <Pill label={t('Create profile')} icon="user" primary onPress={() => onOpenProfile('me')} />
        </View>
      );
    }
    if (composing) {
      return (
        <People onPick={(code) => { setComposing(false); openChat(code); }} />
      );
    }
    return <ChatsList onOpen={(code) => openChat(code)} onNew={() => setComposing(true)} />;
  };

  return (
    <>
      {/* collapsed: the pill */}
      {!mobile && !chat.open && !mounted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? t('Messages, {n} unread', { n: unread }) : t('Messages')}
          onPress={() => openChat()}
          style={({ pressed, hovered }: any) => [s.pill, place, glow('#1E2950', 28, 0.5), { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1, transform: [{ translateY: hovered ? -2 : 0 }] }, Platform.OS === 'web' && ({ transitionProperty: 'transform', transitionDuration: '150ms' } as object)]}
        >
          <View>
            <Feather name="heart" size={24} color={c.text} />
            {unread > 0 ? (
              <View style={[s.badge, { backgroundColor: c.expense, borderColor: c.card }]}>
                <Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[type.label, { color: c.text }]}>{t('Messages')}</Text>
          {latest ? <Avatar name={latest.displayName} id={latest.code} color={latest.color} photo={latest.photo} size={32} /> : null}
        </Pressable>
      ) : null}

      {/* open on a computer: a click anywhere outside the window folds it */}
      {!mobile && chat.open ? <Pressable accessible={false} focusable={false} onPress={closeChat} style={s.backdrop} /> : null}

      {/* open: the window */}
      {mounted ? (
        <Animated.View
          style={[
            s.window,
            mobile ? { left: 0, right: 0, top: 0, bottom: 0, borderRadius: 0, borderWidth: 0 } : { ...place, width: WIDTH, height, borderRadius: radius.card },
            !mobile && glow('#1E2950', 40, 0.5),
            { backgroundColor: c.card, borderColor: c.border, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] },
          ]}
        >
          <View style={[s.header, mobile && s.headerPhone, { borderBottomColor: c.border }]}>
            {chat.with ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} onPress={chatList} style={s.iconBtn}>
                  <Feather name="arrow-left" size={22} color={c.text} />
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => { if (chat.with) { onOpenProfile(chat.with); closeChat(); } }} style={s.who}>
                  {peer ? <Avatar name={peer.displayName} id={peer.code} color={peer.color} photo={peer.photo} size={36} /> : null}
                  <Text style={[type.title, { color: c.text, flexShrink: 1 }]} numberOfLines={1}>{peer?.displayName ?? t('Conversation')}</Text>
                </Pressable>
              </>
            ) : (
              <View style={[s.who, { paddingLeft: mobile ? 0 : spacing.sm }]}>
                {mobile && !composing ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} onPress={closeChat} style={s.iconBtn}>
                    <Feather name="arrow-left" size={24} color={c.text} />
                  </Pressable>
                ) : null}
                {composing ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} onPress={() => setComposing(false)} style={[s.iconBtn, { marginLeft: -spacing.sm }]}>
                    <Feather name="arrow-left" size={22} color={c.text} />
                  </Pressable>
                ) : null}
                <Text style={[type.title, { color: c.text }]}>{composing ? t('New chat') : t('Messages')}</Text>
                {unread > 0 && !composing ? (
                  <View style={[s.count, { backgroundColor: c.expense }]}>
                    <Text style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                ) : null}
              </View>
            )}
            {mobile ? null : (
              <Pressable accessibilityRole="button" accessibilityLabel={t('Close chat')} onPress={closeChat} style={s.iconBtn}>
                <Feather name="x" size={22} color={c.textMuted} />
              </Pressable>
            )}
          </View>
          {profile && chat.with ? (
            <Thread key={chat.with} id={chat.with} />
          ) : (
            <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
              {body()}
            </ScrollView>
          )}
        </Animated.View>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  pill: { position: 'absolute', zIndex: 30, minHeight: 56, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  badge: { position: 'absolute', top: -8, right: -10, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 12, lineHeight: 14, fontWeight: '700' },
  count: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 29 },
  window: { position: 'absolute', zIndex: 31, overflow: 'hidden', borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 60, paddingHorizontal: spacing.sm, borderBottomWidth: 1 },
  /** a screen's top bar on the phone, with a back arrow (the chat sits inside the app, which is already below the banner and the status area) */
  headerPhone: { minHeight: 64, paddingLeft: spacing.sm },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  cta: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  ctaIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
