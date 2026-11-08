import { call } from '../store/sync';

/** The social layer of the API (profiles, follows, messages and the shared summary). People are always identified by their handle. */

export interface Relation {
  following: boolean;
  followsMe: boolean;
  mutual: boolean;
}
export interface Person {
  handle: string;
  displayName: string;
  bio: string | null;
  color: string | null;
  relation: Relation;
}
export interface MyProfile {
  handle: string;
  displayName: string;
  bio: string | null;
  color: string | null;
}
export interface PersonDetail extends Person {
  followers: number;
  following: number;
  self: boolean;
  /** I can read their summary now */
  summaryAccess: boolean;
  /** I currently share mine with them */
  sharedWithThem: boolean;
}
export interface Message {
  id: string;
  mine: boolean;
  body: string;
  createdAt: number;
  readAt: number | null;
}
export interface Conversation {
  with: Person;
  last: { id: string; mine: boolean; body: string; createdAt: number };
  unread: number;
}

/** A short, aggregated picture of the finances: no single transaction ever leaves the account. */
export interface Summary {
  version: 1;
  generatedAt: number;
  /** oldest first, cents */
  months: { key: string; income: number; expense: number; left: number }[];
  /** expense by category over the same months, cents */
  categories: { slug: string; label: string; amount: number }[];
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body });
const enc = encodeURIComponent;

export const socialApi = {
  profile: () => call<{ profile: MyProfile | null; followers: number; following: number }>('/profile'),
  saveProfile: (p: { handle: string; displayName: string; bio?: string; color?: string }) => call<{ profile: MyProfile }>('/profile', { method: 'PUT', body: p }),
  search: (q: string) => call<{ people: Person[] }>(`/people?q=${enc(q)}`),
  person: (handle: string) => call<{ person: PersonDetail }>(`/people/${enc(handle)}`),
  follow: (handle: string) => post<{ ok: true }>('/follow', { handle }),
  unfollow: (handle: string) => post<{ ok: true }>('/unfollow', { handle }),
  follows: () => call<{ following: Person[]; followers: Person[] }>('/follows'),
  conversations: () => call<{ conversations: Conversation[] }>('/conversations'),
  messages: (handle: string, since?: number) => call<{ messages: Message[]; canSend: boolean }>(`/messages/${enc(handle)}${since ? `?since=${since}` : ''}`),
  send: (to: string, body: string) => post<{ message: Message }>('/messages', { to, body }),
  markRead: (handle: string) => post<{ ok: true }>('/messages/read', { handle }),
  unread: () => call<{ unread: number }>('/unread'),
  shares: () => call<{ given: Person[]; received: Person[] }>('/shares'),
  share: (handle: string) => post<{ ok: true }>('/shares', { handle }),
  revoke: (handle: string) => post<{ ok: true }>('/shares/revoke', { handle }),
  publishSummary: (summary: Summary) => call<{ ok: true }>('/summary', { method: 'PUT', body: summary }),
  summaryOf: (handle: string) => call<{ summary: Summary | null; updatedAt: number | null }>(`/people/${enc(handle)}/summary`),
};
