import { Feather } from '@expo/vector-icons';
import React from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { useAssistant } from '../assistant/AssistantProvider';
import { CLAUDE, ClaudeBadge, ClaudeButton } from '../components/ClaudeMark';
import { Sheet } from '../components/Sheet';
import { t } from '../i18n';
import { spacing, type, useColors } from '../theme';

/** Opens a link in a new tab (the web) or the system browser. */
export function openExternal(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else void Linking.openURL(url);
}

/**
 * Ask Claude, kept simple: what it gives you, and Connect or Disconnect. Connecting opens Claude with the connector already
 * filled in; Claude asks for the OK and brings the person to the consent page of the app.
 */
export function AssistantSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { connections, connectLink, disconnect } = useAssistant();
  const connected = connections.length > 0;
  const benefits = [
    { icon: 'message-circle' as const, text: t('Ask about your money and get answers from your own numbers.') },
    { icon: 'plus-circle' as const, text: t('Say what you spent and it is added for you.') },
    { icon: 'mail' as const, text: t('Get reports by email: this week, fast food, anything you ask.') },
  ];
  return (
    <Sheet screen visible={visible} title={t('Ask Claude')} onClose={onClose}>
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <ClaudeBadge size={72} />
        <Text style={[type.title, { color: c.text, textAlign: 'center' }]}>{t('Talk to Claude about your money')}</Text>
        <Text style={[type.body, { color: c.textMuted, textAlign: 'center', maxWidth: 420 }]}>{t('It uses your own Claude account.')}</Text>
      </View>

      <View style={{ gap: spacing.md }}>
        {benefits.map((b) => (
          <View key={b.icon} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <Feather name={b.icon} size={22} color={CLAUDE.orange} style={{ marginTop: 1 }} />
            <Text style={[type.body, { color: c.text, flex: 1 }]}>{b.text}</Text>
          </View>
        ))}
      </View>

      {connected ? (
        <View style={{ gap: spacing.md, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Feather name="check-circle" size={20} color={CLAUDE.orange} />
            <Text style={[type.label, { color: c.text }]}>{t('Connected to {name}', { name: connections[0]!.name })}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Disconnect {name}', { name: connections[0]!.name })} onPress={() => void Promise.all(connections.map((cn) => disconnect(cn.id)))} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.label, { color: c.expense }]}>{t('Disconnect')}</Text>
          </Pressable>
        </View>
      ) : (
        <ClaudeButton label={t('Connect with Claude')} onPress={() => openExternal(connectLink)} />
      )}
    </Sheet>
  );
}
