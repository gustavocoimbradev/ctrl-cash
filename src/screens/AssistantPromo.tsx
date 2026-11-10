import React from 'react';
import { Text, View } from 'react-native';
import { useAssistant } from '../assistant/AssistantProvider';
import { CLAUDE, ClaudeBadge, ClaudeButton } from '../components/ClaudeMark';
import { t } from '../i18n';
import { radius, spacing, type, useColors } from '../theme';
import { openExternal } from './AssistantSheet';

/** A card on the dashboard for as long as Claude is not connected: connecting is one click away (disconnecting is in Account settings). */
export function AssistantPromo({ compact }: { compact?: boolean }) {
  const c = useColors();
  const { loaded, connections, connectLink } = useAssistant();
  if (!loaded || connections.length > 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: compact ? spacing.md : spacing.lg, backgroundColor: c.card, borderRadius: radius.card, padding: compact ? spacing.md : spacing.lg, marginBottom: compact ? spacing.md : spacing.lg, borderWidth: 1, borderColor: CLAUDE.orange }}>
      <ClaudeBadge size={compact ? 40 : 52} />
      <View style={{ flex: 1, minWidth: compact ? 0 : 220, gap: 2 }}>
        <Text style={[type.title, { color: c.text, fontSize: compact ? 18 : undefined }]}>{t('Talk to Claude about your money')}</Text>
        {!compact && <Text style={[type.body, { color: c.textMuted }]}>{t('Ask how you are doing and have it add transactions for you.')}</Text>}
      </View>
      <View style={compact ? { flexBasis: '100%' } : undefined}>
        <ClaudeButton label={t('Connect with Claude')} onPress={() => openExternal(connectLink)} />
      </View>
    </View>
  );
}
