import React from 'react';
import { Text, View } from 'react-native';
import { spacing, type, useColors } from '../theme';
import { useSocial } from './SocialProvider';
import { Empty, Pill, PersonRow } from './parts';

const preview = (mine: boolean, body: string) => `${mine ? 'You: ' : ''}${body.replace(/\s+/g, ' ')}`;

/** The conversations, newest first, with what is unread. */
export function ChatsList({ onOpen, onNew }: { onOpen: (code: string) => void; onNew: () => void }) {
  const c = useColors();
  const { conversations } = useSocial();
  if (conversations.length === 0) {
    return (
      <View style={{ alignItems: 'center' }}>
        <Empty icon="heart" text="No conversations yet. Start one with the other person's code." />
        <Pill label="New chat" icon="plus" primary onPress={onNew} />
      </View>
    );
  }
  return (
    <View style={{ gap: spacing.xs }}>
      <Pill label="New chat" icon="plus" onPress={onNew} />
      {conversations.map((cv) => (
        <PersonRow
          key={cv.with.code}
          person={cv.with}
          subtitle={preview(cv.last.mine, cv.last.body)}
          onPress={() => onOpen(cv.with.code)}
          right={
            cv.unread > 0 ? (
              <View style={{ minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={[type.body, { color: c.onPrimary, fontSize: 16, lineHeight: 20, fontWeight: '700' }]}>{cv.unread > 99 ? '99+' : cv.unread}</Text>
              </View>
            ) : null
          }
        />
      ))}
    </View>
  );
}
