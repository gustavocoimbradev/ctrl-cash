import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildSummary } from '../domain/summary';
import { useStore } from '../store';
import { Conversation, MyProfile, Person, socialApi } from './api';
import { fallbackName } from './names';

interface Social {
  /** false until the first answer of the API */
  loaded: boolean;
  /** the person's own profile; null until they create one */
  profile: MyProfile | null;
  conversations: Conversation[];
  unread: number;
  /** people I share my summary with, and people sharing theirs with me */
  given: Person[];
  received: Person[];
  /** fresh lists (the chat polls faster while it is open) */
  refresh: () => Promise<void>;
  saveProfile: (p: { displayName: string; color?: string; photo?: string | null }) => Promise<void>;
  share: (id: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
  /** the floating chat: open or collapsed, and which conversation it shows (null = the list) */
  chat: { open: boolean; with: string | null };
  openChat: (id?: string) => void;
  closeChat: () => void;
  /** back from a conversation to the list */
  chatList: () => void;
}

const Ctx = createContext<Social | null>(null);

const BADGE_MS = 12000;
const OPEN_MS = 5000;
/** a changed summary is published a little after the last change, and never more often than this */
const PUBLISH_DELAY_MS = 2500;

/** `account.name` is the display name of the signed-in account (typed at sign-up, or the one Google gives); it becomes the profile name. */
export function SocialProvider({ children, account }: { children: React.ReactNode; account: { email: string; name: string } }) {
  const { data, ready } = useStore();
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [unread, setUnread] = useState(0);
  const [given, setGiven] = useState<Person[]>([]);
  const [received, setReceived] = useState<Person[]>([]);
  const [chat, setChat] = useState<{ open: boolean; with: string | null }>({ open: false, with: null });
  const open = chat.open;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await socialApi.profile();
      if (!alive.current) return;
      setProfile(me.profile);
      setLoaded(true);
      if (!me.profile) return;
      const [conv, unreadRes, shares] = await Promise.all([socialApi.conversations(), socialApi.unread(), socialApi.shares()]);
      if (!alive.current) return;
      setConversations(conv.conversations);
      setUnread(unreadRes.unread);
      setGiven(shares.given);
      setReceived(shares.received);
    } catch {
      // offline or signed out: the lists keep what they had and the next poll tries again
    }
  }, []);

  // everybody has a profile (and its code) from the first access, named after the account: the name typed at sign-up or
  // given by Google, else the email's first part. An account that only had that placeholder name takes the Google name
  // when it later signs in with Google.
  const created = useRef(false);
  const renamed = useRef('');
  useEffect(() => {
    if (!loaded) return;
    const given = account.name.trim();
    const placeholder = fallbackName(account.email);
    if (!profile) {
      if (created.current) return;
      created.current = true;
      void socialApi.saveProfile({ displayName: (given || placeholder).slice(0, 40) }).then(() => refresh()).catch(() => { created.current = false; });
    } else if (given && given !== profile.displayName && profile.displayName === placeholder && renamed.current !== given) {
      renamed.current = given;
      void socialApi.saveProfile({ displayName: given.slice(0, 40) }).then(() => refresh()).catch(() => { renamed.current = ''; });
    }
  }, [loaded, profile, account.name, account.email, refresh]);

  // the badge: a light poll while the app is open, a faster one while the panel is
  useEffect(() => {
    if (!ready) return;
    void refresh();
    const timer = setInterval(() => void refresh(), open ? OPEN_MS : BADGE_MS);
    return () => clearInterval(timer);
  }, [ready, open, refresh]);

  /** runs an action, then brings the lists up to date */
  const then = useCallback(
    <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) => async (...a: A) => {
      await fn(...a);
      await refresh();
    },
    [refresh],
  );

  // publishing the summary: only while somebody can read it, and only when it changed
  const lastPublished = useRef('');
  useEffect(() => {
    if (!ready || given.length === 0) return;
    const timer = setTimeout(() => {
      const summary = buildSummary(data);
      const fingerprint = JSON.stringify({ s: summary.spent, v: summary.saved, m: summary.months, c: summary.categories });
      if (fingerprint === lastPublished.current) return;
      socialApi.publishSummary(summary).then(() => { lastPublished.current = fingerprint; }).catch(() => {});
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, data, given.length]);

  const value = useMemo<Social>(
    () => ({
      loaded,
      profile,
      conversations,
      unread,
      given,
      received,
      refresh,
      saveProfile: then(async (p: Parameters<Social['saveProfile']>[0]) => { await socialApi.saveProfile(p); }),
      share: then(async (h: string) => { await socialApi.share(h); lastPublished.current = ''; }),
      revoke: then(async (h: string) => { await socialApi.revoke(h); }),
      chat,
      openChat: (id?: string) => setChat((c) => ({ open: true, with: id ?? c.with })),
      closeChat: () => setChat((c) => ({ ...c, open: false })),
      chatList: () => setChat((c) => ({ ...c, with: null })),
    }),
    [loaded, profile, conversations, unread, given, received, chat, refresh, then],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocial(): Social {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSocial must be used inside SocialProvider');
  return v;
}
