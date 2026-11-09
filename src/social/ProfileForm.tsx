import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../components/Button';
import { TextField } from '../components/Fields';
import { spacing, type, useColors } from '../theme';
import { MyProfile } from './api';
import { useSocial } from './SocialProvider';
import { fallbackName } from './names';
import { photoSupported, pickPhoto } from './photo';
import { Avatar, Pill } from './parts';
import { t } from '../i18n';

/** Creates the profile (first time) or edits it: a photo and a name. */
export function ProfileForm({ email, existing, onDone }: { email: string; existing: MyProfile | null; onDone: () => void }) {
  const c = useColors();
  const { saveProfile } = useSocial();
  const [name, setName] = useState(existing?.displayName ?? fallbackName(email));
  /** the photo shown now; `changed` says whether it differs from the saved one (so an untouched photo is not sent again) */
  const [photo, setPhoto] = useState<string | null>(existing?.photo ?? null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) return setError(t('Add the name people will see.'));
    setBusy(true);
    setError('');
    try {
      await saveProfile({ displayName: name.trim(), ...(changed ? { photo } : {}) });
      onDone();
    } catch (e) {
      setError(t('Could not save. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <Avatar name={name} id={existing?.code ?? 'me'} color={existing?.color} photo={photo} size={96} />
        {photoSupported ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Pill
              label={photo ? t('Change photo') : t('Add photo')}
              icon="camera"
              onPress={() => void pickPhoto().then((p) => { if (p) { setPhoto(p); setChanged(true); } })}
            />
            {photo ? <Pill label={t('Remove')} danger onPress={() => { setPhoto(null); setChanged(true); }} /> : null}
          </View>
        ) : null}
      </View>
      {!existing ? <Text style={[type.body, { color: c.textMuted, textAlign: 'center' }]}>{t('Create your profile to follow people and chat. Nothing about your money is shown unless you choose to share it.')}</Text> : null}
      <TextField label={t('Name')} value={name} onChangeText={setName} maxLength={40} placeholder={t('Your name')} />
      {error ? <Text style={[type.body, { color: c.expense }]}>{error}</Text> : null}
      <Button label={busy ? t('Saving...') : existing ? t('Save profile') : t('Create profile')} icon="check" onPress={submit} disabled={busy} />
    </View>
  );
}
