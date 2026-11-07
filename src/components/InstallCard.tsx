import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, type } from '../theme';

interface Installer {
  ready: boolean;
  run: () => void;
}

const KEY = 'ctrlcash:install-dismissed';
const installer = (): Installer | undefined => (Platform.OS === 'web' ? (window as unknown as { ctrlInstall?: Installer }).ctrlInstall : undefined);

/**
 * Computers: instead of the top bar the phones get, a slim brand-blue strip inside the app. It only exists when
 * the browser can install the app (the page script says so) and goes away for good once dismissed on this device.
 */
export function InstallCard() {
  const [ready, setReady] = useState(() => !!installer()?.ready);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Platform.OS === 'web' && window.localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const sync = () => setReady(!!installer()?.ready);
    window.addEventListener('installready', sync);
    sync();
    return () => window.removeEventListener('installready', sync);
  }, []);
  if (!ready || dismissed) return null;
  const close = () => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      // private window: it shows again next time
    }
    setDismissed(true);
  };
  return (
    <View style={s.bar}>
      <Image source={require('../../assets/icon.png')} style={s.icon} />
      <Text style={[type.body, s.text]} numberOfLines={1}>Install Ctrl+Cash to open it like an app.</Text>
      <Pressable accessibilityRole="button" onPress={() => installer()?.run()} style={({ hovered }: any) => [s.btn, { backgroundColor: hovered ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.18)' }]}>
        <Text style={[type.label, { color: '#FFFFFF' }]}>Install</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={close} style={s.close}>
        <Feather name="x" size={18} color="#DCE5FF" />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#2D55D9', borderRadius: radius.control, paddingLeft: spacing.md, paddingRight: spacing.xs, minHeight: 52 },
  icon: { width: 30, height: 30, borderRadius: 8 },
  text: { flex: 1, minWidth: 0, color: '#FFFFFF' },
  btn: { minHeight: 36, paddingHorizontal: spacing.lg, borderRadius: radius.control - 4, alignItems: 'center', justifyContent: 'center' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
