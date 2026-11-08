import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildSummary } from '../domain/summary';
import { useStore } from '../store';
import { Conversation, MyProfile, Person, socialApi } from './api';

interface Social {
  /** false until the first answer of the API */
  loaded: boolean;
  /** the person's own profile; null until they create one */
  profile: MyProfile | null;
  counts: { followers: number; following: number };
  conversations: Conversation[];
  unread: number;
  following: Person[];
  followers: Person[];
  /** people I share my summary with, and people sharing theirs with me */
  given: Person[];
  received: Person[];
  /** the panel asks for fresh lists when it opens (and while it stays open) */
  refresh: () => Promise<void>;
  saveProfile: (p: { handle: string; displayName: string; bio?: string; color?: string }) => Promise<void>;
  follow: (handle: string) => Promise<void>;
  unfollow: (handle: string) => Promise<void>;
  share: (handle: string) => Promise<void>;
  revoke: (handle: string) => Promise<void>;
  /** the panel being open makes the lists poll faster */
  setPanelOpen: (open: boolean) => void;
}

const Ctx = createContext<Social | null>(null);

const BADGE_MS = 12000;
const OPEN_MS = 5000;
/** a changed summary is published a little after the last change, and never more often than this */
const PUBLISH_DELAY_MS = 2500;

export function SocialProvider({ children }: { children: React.ReactNode }) {
  const { data, ready } = useStore();
  const [loaded, setLoaded] = useState(false);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [unread, setUnread] = useState(0);
  const [following, setFollowing] = useState<Person[]>([]);
  const [followers, setFollowers] = useState<Person[]>([]);
  const [given, setGiven] = useState<Person[]>([]);
  const [received, setReceived] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await socialApi.profile();
      if (!alive.current) return;
      setProfile(me.profile);
      setCounts({ followers: me.followers, following: me.following });
      setLoaded(true);
      if (!me.profile) return;
      const [conv, unreadRes, follows, shares] = await Promise.all([socialApi.conversations(), socialApi.unread(), socialApi.follows(), socialApi.shares()]);
      if (!alive.current) return;
      setConversations(conv.conversations);
      setUnread(unreadRes.unread);
      setFollowing(follows.following);
      setFollowers(follows.followers);
      setGiven(shares.given);
      setReceived(shares.received);
    } catch {
      // offline or signed out: the lists keep what they had and the next poll tries again
    }
  }, []);

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
      const fingerprint = JSON.stringify({ m: summary.months, c: summary.categories });
      if (fingerprint === lastPublished.current) return;
      socialApi.publishSummary(summary).then(() => { lastPublished.current = fingerprint; }).catch(() => {});
    }, PUBLISH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, data, given.length]);

  const value = useMemo<Social>(
    () => ({
      loaded,
      profile,
      counts,
      conversations,
      unread,
      following,
      followers,
      given,
      received,
      refresh,
      saveProfile: then(async (p: Parameters<Social['saveProfile']>[0]) => { await socialApi.saveProfile(p); }),
      follow: then(async (h: string) => { await socialApi.follow(h); }),
      unfollow: then(async (h: string) => { await socialApi.unfollow(h); }),
      share: then(async (h: string) => { await socialApi.share(h); lastPublished.current = ''; }),
      revoke: then(async (h: string) => { await socialApi.revoke(h); }),
      setPanelOpen: setOpen,
    }),
    [loaded, profile, counts, conversations, unread, following, followers, given, received, refresh, then],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocial(): Social {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSocial must be used inside SocialProvider');
  return v;
}
