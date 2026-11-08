import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { TextField } from '../components/Fields';
import { radius, spacing, type, useColors } from '../theme';
import { MyProfile } from './api';
import { useSocial } from './SocialProvider';
import { AVATAR_COLORS, Avatar, colorFor } from './parts';

const nice = (email: string) => {
  const n = (email.split('@')[0] ?? '').replace(/[._-]+/g, ' ').trim();
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'Me';
};

/** Creates the profile (first time) or edits it: a name and a color. */
export function ProfileForm({ email, existing, onDone }: { email: string; existing: MyProfile | null; onDone: () => void }) {
  const c = useColors();
  const { saveProfile } = useSocial();
  const [name, setName] = useState(existing?.displayName ?? nice(email));
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) return setError('Add the name people will see.');
    setBusy(true);
    setError('');
    try {
      await saveProfile({ displayName: name.trim(), ...(color ? { color } : {}) });
      onDone();
    } catch (e) {
      setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ alignItems: 'center' }}>
        <Avatar name={name} id={existing?.id ?? 'me'} color={color} size={72} />
      </View>
      {!existing ? <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>Create your profile to follow people and chat. Nothing about your money is shown unless you choose to share it.</Text> : null}
      <TextField label="Name" value={name} onChangeText={setName} maxLength={40} placeholder="Your name" />
      <View style={{ gap: spacing.sm }}>
        <Text style={[type.label, { color: c.text }]}>Color</Text>
        <View style={s.swatches}>
          {AVATAR_COLORS.map((x) => {
            const on = colorFor(existing?.id ?? 'me', color) === x;
            return (
              <Pressable key={x} accessibilityRole="button" accessibilityLabel={`Color ${x}`} accessibilityState={{ selected: on }} onPress={() => setColor(x)} style={[s.swatch, { backgroundColor: x, borderColor: on ? c.text : 'transparent' }]} />
            );
          })}
        </View>
      </View>
      {error ? <Text style={[type.body, { color: c.expense }]}>{error}</Text> : null}
      <Button label={busy ? 'Saving...' : existing ? 'Save profile' : 'Create profile'} icon="check" onPress={submit} disabled={busy} />
    </View>
  );
}

const s = StyleSheet.create({
  swatches: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  swatch: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 3 },
});
