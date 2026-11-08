import { Feather } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius, spacing, type, useColors } from '../theme';
import { Message, socialApi } from './api';
import { useSocial } from './SocialProvider';
import { Empty } from './parts';

const POLL_MS = 3500;
const MAX = 1000;

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayOf = (ms: number) => {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};

/** The conversation with one person: bubbles, day separators and a composer. Polls while it is open. */
export function Thread({ handle }: { handle: string }) {
  const c = useColors();
  const { refresh } = useSocial();
  const [messages, setMessages] = useState<Message[]>([]);
  const [canSend, setCanSend] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const last = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async (first: boolean) => {
    try {
      const res = await socialApi.messages(handle, first ? undefined : last.current || undefined);
      if (!alive.current) return;
      setCanSend(res.canSend);
      if (first) setMessages(res.messages);
      else if (res.messages.length) setMessages((m) => [...m, ...res.messages.filter((x) => !m.some((y) => y.id === x.id))]);
      if (res.messages.length) last.current = Math.max(last.current, ...res.messages.map((m) => m.createdAt));
      setLoaded(true);
      // what the other person wrote has been seen now
      if (res.messages.some((m) => !m.mine && m.readAt === null)) {
        void socialApi.markRead(handle).then(() => refresh()).catch(() => {});
      }
    } catch {
      if (alive.current) setLoaded(true);
    }
  }, [handle, refresh]);

  useEffect(() => {
    last.current = 0;
    setMessages([]);
    setLoaded(false);
    void load(true);
    const timer = setInterval(() => void load(false), POLL_MS);
    return () => clearInterval(timer);
  }, [handle, load]);

  useEffect(() => {
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await socialApi.send(handle, body);
      setText('');
      last.current = Math.max(last.current, res.message.createdAt);
      setMessages((m) => [...m, res.message]);
      void refresh();
    } catch {
      setError('The message was not sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  let lastDay = '';
  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={s.list} keyboardShouldPersistTaps="handled">
        {loaded && messages.length === 0 ? <Empty icon="message-circle" text="No messages yet. Say hi!" /> : null}
        {messages.map((m) => {
          const day = dayOf(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <React.Fragment key={m.id}>
              {showDay ? <Text style={[type.body, s.day, { color: c.textMuted }]}>{day}</Text> : null}
              <View style={[s.line, m.mine ? s.lineMine : s.lineTheirs]}>
                <View style={[s.bubble, m.mine ? { backgroundColor: c.primary, borderBottomRightRadius: 6 } : { backgroundColor: c.surface, borderBottomLeftRadius: 6 }]}>
                  <Text style={[type.body, { color: m.mine ? c.onPrimary : c.text }, Platform.OS === 'web' && ({ whiteSpace: 'pre-wrap', wordBreak: 'break-word' } as object)]} selectable>{m.body}</Text>
                </View>
                <Text style={[s.time, { color: c.textMuted }]}>{timeOf(m.createdAt)}{m.mine && m.readAt ? ' · Seen' : ''}</Text>
              </View>
            </React.Fragment>
          );
        })}
      </ScrollView>

      {canSend ? (
        <View style={[s.composer, { borderTopColor: c.border }]}>
          {error ? <Text style={[type.body, { color: c.expense }]}>{error}</Text> : null}
          <View style={s.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Write a message"
              placeholderTextColor={c.textMuted}
              multiline
              numberOfLines={1}
              maxLength={MAX}
              accessibilityLabel="Message"
              onKeyPress={(e: any) => {
                // Enter sends, Shift+Enter breaks the line (web)
                if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              style={[type.body, s.input, { color: c.text, backgroundColor: c.surface }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              onPress={send}
              disabled={!text.trim() || sending}
              style={({ pressed }) => [s.send, { backgroundColor: c.primary, opacity: !text.trim() || sending ? 0.4 : pressed ? 0.8 : 1 }]}
            >
              <Feather name="send" size={20} color={c.onPrimary} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={[s.composer, { borderTopColor: c.border }]}>
          <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>You can message each other once you both follow each other.</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  day: { textAlign: 'center', marginVertical: spacing.sm },
  line: { maxWidth: '82%', gap: 2 },
  lineMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  lineTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderRadius: radius.card - 6 },
  time: { fontSize: 16, paddingHorizontal: spacing.xs },
  composer: { borderTopWidth: 1, padding: spacing.md, gap: spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: { flex: 1, minHeight: 48, maxHeight: 132, borderRadius: 24, paddingHorizontal: spacing.lg, paddingTop: 12, paddingBottom: 12 },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
