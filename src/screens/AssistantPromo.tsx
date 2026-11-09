import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useAssistant } from '../assistant/AssistantProvider';
import { Button } from '../components/Button';
import { t } from '../i18n';
import { radius, spacing, type, useColors } from '../theme';
import { openExternal } from './AssistantSheet';

const KEY = 'ctrlcash:assistant-promo';
const dismissed = () => {
  try {
    return Platform.OS === 'web' && window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** A card on the dashboard until Claude is connected (or the person says "not now"): connecting is one click away. */
export function AssistantPromo({ onOpen }: { onOpen: () => void }) {
  const c = useColors();
  const { loaded, connections, connectLink } = useAssistant();
  const [hidden, setHidden] = useState(dismissed);
  if (!loaded || connections.length > 0 || hidden) return null;
  const hide = () => {
    try {
      if (Platform.OS === 'web') window.localStorage.setItem(KEY, '1');
    } catch {
      // private window: it shows again next time
    }
    setHidden(true);
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg, backgroundColor: c.card, borderRadius: radius.card, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: 'rgba(45,85,217,0.25)' }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(45,85,217,0.10)', alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="message-circle" size={24} color={c.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
        <Text style={[type.title, { color: c.text }]}>{t('Talk to Claude about your money')}</Text>
        <Text style={[type.body, { color: c.textMuted }]}>{t('Ask how you are doing and have it add transactions for you, with your own Claude account. It costs nothing.')}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
        <Button label={t('Connect with Claude')} icon="link" onPress={() => openExternal(connectLink)} />
        <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
          <Text style={[type.label, { color: c.primary }]}>{t('Learn more')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Not now')} onPress={hide} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
          <Text style={[type.label, { color: c.textMuted }]}>{t('Not now')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
