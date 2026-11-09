import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { useAssistant } from '../assistant/AssistantProvider';
import { Button } from '../components/Button';
import { ToggleRow } from '../components/Controls';
import { Sheet } from '../components/Sheet';
import { shortDate } from '../domain/dates';
import { t } from '../i18n';
import { radius, spacing, type, useColors } from '../theme';

/** Opens a link in a new tab (the web) or the system browser. */
export function openExternal(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else void Linking.openURL(url);
}

/**
 * Ask Claude: connect Claude (the person's own account, the free plan works) in one click, see what it may do and turn adding
 * transactions on or off. Connecting opens Claude's "add connector" form already filled in; Claude asks for the OK and brings
 * the person to the consent page of the app.
 */
export function AssistantSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useColors();
  const { connections, mcpUrl, snapshotAt, connectLink, disconnect, setCanWrite } = useAssistant();
  const [copied, setCopied] = useState(false);
  const connected = connections.length > 0;
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // no clipboard: the address is on screen
    }
  };
  const examples = [
    t('How am I doing this month?'),
    t('Where can I cut spending?'),
    t('Is it worth paying this in installments?'),
    t('Add a 45.90 expense at the pharmacy, paid today.'),
  ];

  return (
    <Sheet screen visible={visible} title={t('Ask Claude')} onClose={onClose}>
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(45,85,217,0.10)', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="message-circle" size={30} color={c.primary} />
        </View>
        <Text style={[type.title, { color: c.text, textAlign: 'center' }]}>{t('Talk to Claude about your money')}</Text>
        <Text style={[type.body, { color: c.textMuted, textAlign: 'center', maxWidth: 440 }]}>{t('Claude reads your finances and answers about them, and can add transactions for you. It uses your own Claude account (the free plan works), so this costs nothing.')}</Text>
      </View>

      {!connected ? (
        <View style={{ gap: spacing.md }}>
          <Button label={t('Connect with Claude')} icon="link" onPress={() => openExternal(connectLink)} />
          <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>{t('Claude opens with the connector filled in. Confirm there, then allow it here when it brings you back.')}</Text>
          <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.lg }}>
            <Text style={[type.label, { color: c.text }]}>{t('Or add it by hand')}</Text>
            <Text style={[type.body, { color: c.textMuted }]}>{t('In Claude, open Settings, then Connectors, then Add custom connector, and paste this address.')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Copy the address')}
              onPress={copy}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, minHeight: 48, opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={[type.body, { color: c.text, flex: 1 }]} numberOfLines={1} selectable>{mcpUrl}</Text>
              <Feather name={copied ? 'check' : 'copy'} size={18} color={copied ? c.income : c.textMuted} />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {connections.map((cn) => (
            <View key={cn.id} style={{ gap: spacing.sm, backgroundColor: c.surface, borderRadius: radius.card - 6, padding: spacing.lg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Feather name="check-circle" size={22} color={c.income} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.label, { color: c.text }]} numberOfLines={1}>{t('Connected to {name}', { name: cn.name })}</Text>
                  <Text style={[type.body, { color: c.textMuted }]} numberOfLines={1}>{cn.lastUsedAt ? t('Last used {date}', { date: shortDate(cn.lastUsedAt, true) }) : t('Connected {date}', { date: shortDate(cn.createdAt, true) })}</Text>
                </View>
              </View>
              <ToggleRow
                label={t('Let it add transactions')}
                hint={t('You still confirm each one in Claude. It never edits or removes anything.')}
                value={cn.canWrite}
                onChange={(v) => void setCanWrite(cn.id, v)}
              />
              <Pressable accessibilityRole="button" accessibilityLabel={t('Disconnect {name}', { name: cn.name })} onPress={() => void disconnect(cn.id)} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text style={[type.label, { color: c.expense }]}>{t('Disconnect')}</Text>
              </Pressable>
            </View>
          ))}
          <Button label={t('Open Claude')} icon="external-link" variant="secondary" onPress={() => openExternal('https://claude.ai/new')} />
          <Text style={[type.body, { color: c.textMuted }]}>
            {snapshotAt ? t('While connected, the app keeps a picture of your finances up to date for Claude (last update {date}). Disconnecting removes its access at once.', { date: shortDate(snapshotAt, true) }) : t('While connected, the app keeps a picture of your finances up to date for Claude. Disconnecting removes its access at once.')}
          </Text>
        </View>
      )}

      <View style={{ gap: spacing.sm }}>
        <Text style={[type.title, { color: c.text }]}>{t('Things to ask')}</Text>
        {examples.map((e) => (
          <View key={e} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <Feather name="message-square" size={18} color={c.textMuted} style={{ marginTop: 3 }} />
            <Text style={[type.body, { color: c.text, flex: 1 }]}>{e}</Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}
