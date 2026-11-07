import { Feather } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors as c, spacing, type } from '../theme';
import { Button } from './Button';
import { Sheet } from './Sheet';

interface Help {
  title: string;
  text: string;
}

const Ctx = createContext<(h: Help) => void>(() => {});

/**
 * One help dialog for the whole screen: the "?" buttons only ask it to open. (A dialog per button, nested
 * inside pressable cards, would let taps in the dialog reach the card underneath.)
 */
export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [help, setHelp] = useState<Help | null>(null);
  const [open, setOpen] = useState(false);
  const show = useCallback((h: Help) => {
    setHelp(h);
    setOpen(true);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet visible={open} title={help?.title ?? ''} onClose={() => setOpen(false)} footer={<Button label="Got it" onPress={() => setOpen(false)} flex />}>
        <Text style={[type.body, { color: c.text }]}>{help?.text}</Text>
      </Sheet>
    </Ctx.Provider>
  );
}

/**
 * Discreet help mark after a card title: a thin outlined "?" icon, faint at rest and a little firmer under the
 * pointer (no filled circle, nothing that competes with the title). Opens a dialog with a short explanation.
 * Tight to the title (about 6px) and centered on its line; the 44px touch target comes from `hitSlop`, an invisible margin
 * around the icon, so it neither pushes the icon away from the text nor makes the title row taller.
 */
export function HelpTip({ title, text }: { title: string; text: string }) {
  const show = useContext(Ctx);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`What is ${title}?`}
      onPress={() => show({ title, text })}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 14 }}
      style={({ pressed }) => [s.hit, { opacity: pressed ? 0.6 : 1 }]}
    >
      {({ hovered }: any) => <Feather name="help-circle" size={16} color={c.textMuted} style={{ opacity: hovered ? 0.9 : 0.45, transform: [{ translateY: 2 }] }} />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  hit: { width: 22, height: 24, alignItems: 'center', justifyContent: 'center' },
});
