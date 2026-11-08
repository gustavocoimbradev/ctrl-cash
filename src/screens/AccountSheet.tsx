import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { authMessage, currentHasPassword, savePassword } from '../firebase/useAuth';
import { useStore } from '../store';
import { radius, spacing, type, useColors } from '../theme';

/**
 * Account settings: the email, the password (changed, or set for the first time when the account only uses Google)
 * and "Clear everything", which archives all the data (nothing is deleted) so the account starts over.
 */
export function AccountSheet({ visible, email, onClose, onCleared }: { visible: boolean; email: string; onClose: () => void; onCleared: () => void }) {
  const c = useColors();
  const { clearAll } = useStore();
  const [hasPassword, setHasPassword] = useState(currentHasPassword());
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setHasPassword(currentHasPassword());
    setCurrent('');
    setNext('');
    setAgain('');
    setError('');
    setDone('');
    setConfirming(false);
  }, [visible]);

  const submit = async () => {
    if (busy) return;
    setDone('');
    if (hasPassword && !current) return setError('Enter your current password.');
    if (next.length < 6) return setError('Use a password with 6+ characters.');
    if (next !== again) return setError('The passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await savePassword(current, next);
      setHasPassword(true);
      setCurrent('');
      setNext('');
      setAgain('');
      setDone(hasPassword ? 'Password changed.' : 'Password set. You can now sign in with it too.');
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const input = (label: string, value: string, set: (v: string) => void, auto: 'current-password' | 'new-password') => (
    <View style={{ gap: spacing.xs }}>
      <Text style={[type.label, { color: c.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={set}
        secureTextEntry
        autoComplete={auto}
        maxLength={128}
        accessibilityLabel={label}
        style={[type.body, { color: c.text, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, minHeight: 48, borderWidth: 1.5, borderColor: 'transparent' }]}
      />
    </View>
  );

  return (
    <Sheet screen visible={visible} title="Account" onClose={onClose}>
      <View style={{ gap: spacing.xl }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.label, { color: c.text }]}>Email</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: c.surface, borderRadius: radius.control, paddingHorizontal: spacing.lg, minHeight: 48 }}>
            <Feather name="mail" size={20} color={c.textMuted} />
            <Text style={[type.body, { color: c.text, flex: 1 }]} numberOfLines={1}>{email}</Text>
          </View>
        </View>

        <View style={{ gap: spacing.md }}>
          <Text style={[type.title, { color: c.text }]}>{hasPassword ? 'Change password' : 'Set a password'}</Text>
          {!hasPassword && <Text style={[type.body, { color: c.textMuted }]}>This account signs in with Google. A password lets you sign in with your email too.</Text>}
          {hasPassword && input('Current password', current, setCurrent, 'current-password')}
          {input(hasPassword ? 'New password' : 'Password', next, setNext, 'new-password')}
          {input('Repeat the password', again, setAgain, 'new-password')}
          {error ? <Text style={[type.body, { color: c.expense }]}>{error}</Text> : null}
          {done ? <Text style={[type.body, { color: c.income }]}>{done}</Text> : null}
          <Button label={busy ? 'Saving...' : hasPassword ? 'Change password' : 'Set password'} onPress={submit} disabled={busy} />
        </View>

        <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: c.border, paddingTop: spacing.xl }}>
          <Text style={[type.title, { color: c.text }]}>Start over</Text>
          <Text style={[type.body, { color: c.textMuted }]}>
            Starts the account over: transactions, cards, payments, reserves and categories leave the app, and the quick setup comes back. Nothing is permanently deleted.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirming(true)}
            style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[type.label, { color: c.expense }]}>Clear everything</Text>
          </Pressable>
        </View>
      </View>
      <Sheet
        visible={confirming}
        title="Clear everything"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setConfirming(false)} flex />
            <Button label="Clear everything" danger flex onPress={() => { setConfirming(false); clearAll(); onCleared(); }} />
          </>
        }
      >
        <Text style={[type.body, { color: c.text }]}>
          Everything leaves the app and the quick setup comes back. It is archived, so nothing is permanently deleted.
        </Text>
      </Sheet>
    </Sheet>
  );
}
