import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useAssistant } from '../assistant/AssistantProvider';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ClaudeBadge } from '../components/ClaudeMark';
import { t } from '../i18n';
import { call } from '../store/sync';
import { spacing, type, useColors } from '../theme';

export interface ConnectParams {
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
}

/**
 * The consent page of the AI connection: an assistant (Claude) asked to read the person's finances. They see what it can and
 * cannot do and say yes or no; either way the browser goes back to the assistant.
 */
export function ConnectPage({ params, onBack }: { params: ConnectParams; onBack: () => void }) {
  const c = useColors();
  const { publishNow, refresh } = useAssistant();
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const valid = !!(params.client_id && params.redirect_uri && params.code_challenge);

  useEffect(() => {
    if (!valid) return;
    call<{ name: string }>(`/oauth/client?client_id=${encodeURIComponent(params.client_id!)}&redirect_uri=${encodeURIComponent(params.redirect_uri!)}`)
      .then((r) => setName(r.name))
      .catch(() => setName(''));
  }, [valid, params.client_id, params.redirect_uri]);

  const decide = async (allow: boolean) => {
    setState('busy');
    try {
      const res = await call<{ redirect: string }>(allow ? '/oauth/approve' : '/oauth/deny', {
        method: 'POST',
        body: { client_id: params.client_id, redirect_uri: params.redirect_uri, state: params.state, code_challenge: params.code_challenge, write: allow || undefined, social: allow || undefined, email: allow || undefined },
      });
      // the connection exists now: the picture of the finances is published before going back, so the first question already has data
      if (allow) {
        await publishNow();
        await refresh();
      }
      if (Platform.OS === 'web') window.location.href = res.redirect;
    } catch {
      setState('failed');
    }
  };

  if (!valid || name === '') {
    return (
      <Card style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Text style={[type.title, { color: c.text }]}>{t('This connection link is not valid')}</Text>
        <Text style={[type.body, { color: c.textMuted }]}>{t('Start the connection again from the assistant.')}</Text>
        <Button label={t('Back to the app')} variant="secondary" onPress={onBack} />
      </Card>
    );
  }
  const who = name ?? '...';
  return (
    <Card style={{ maxWidth: 560, width: '100%', alignSelf: 'center', gap: spacing.lg }}>
      <View style={{ alignItems: 'center', gap: spacing.sm }}>
        <ClaudeBadge size={64} />
        <Text style={[type.title, { color: c.text, textAlign: 'center' }]}>{t('Connect {name}', { name: who })}</Text>
        <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>{t('{name} wants to connect to your Ctrl+Cash.', { name: who })}</Text>
      </View>
      <View style={{ gap: spacing.sm }}>
        {[
          { icon: 'eye' as const, text: t('It reads your finances to answer your questions.') },
          { icon: 'edit-3' as const, text: t('When you ask, it adds entries, manages your sharing and messages, and emails you reports. It never deletes anything.') },
          { icon: 'x-circle' as const, text: t('You can disconnect at any time.') },
        ].map((r) => (
          <View key={r.icon} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
            <Feather name={r.icon} size={20} color={c.textMuted} style={{ marginTop: 2 }} />
            <Text style={[type.body, { color: c.text, flex: 1 }]}>{r.text}</Text>
          </View>
        ))}
      </View>
      {state === 'failed' ? <Text style={[type.body, { color: c.expense }]}>{t('Could not complete the connection. Try again.')}</Text> : null}
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Button label={t('Cancel')} variant="secondary" onPress={() => void decide(false)} disabled={state === 'busy'} flex />
        <Button label={t('Allow')} icon="check" onPress={() => void decide(true)} disabled={state === 'busy'} flex />
      </View>
    </Card>
  );
}
