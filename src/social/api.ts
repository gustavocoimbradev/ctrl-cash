import { call } from '../store/sync';

/** The social layer of the API (profiles, follows, messages and the shared summary). People are identified by a public id (a uuid, also the one in the profile URL), never by the account id. */

export interface Relation {
  following: boolean;
  followsMe: boolean;
  mutual: boolean;
}
export interface Person {
  id: string;
  displayName: string;
  color: string | null;
  relation: Relation;
}
export interface MyProfile {
  id: string;
  displayName: string;
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

/** A category's share of the income, in percent. */
export interface CategoryShare {
  slug: string;
  label: string;
  pct: number;
}

/**
 * A short picture of the finances made only of PERCENTAGES of income (never amounts, never a single transaction):
 * how much was spent and how much was saved, overall and in each month, and where the spending went.
 */
export interface Summary {
  version: 2;
  generatedAt: number;
  /** overall, % of the income of the months below */
  spent: number;
  saved: number;
  /** oldest first; only months that had income */
  months: { key: string; spent: number; saved: number; categories: CategoryShare[] }[];
  /** overall spending by category, % of income, biggest first */
  categories: CategoryShare[];
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body });
const enc = encodeURIComponent;

export const socialApi = {
  profile: () => call<{ profile: MyProfile | null; followers: number; following: number }>('/profile'),
  saveProfile: (p: { displayName: string; color?: string }) => call<{ profile: MyProfile }>('/profile', { method: 'PUT', body: p }),
  search: (q: string) => call<{ people: Person[] }>(`/people?q=${enc(q)}`),
  person: (id: string) => call<{ person: PersonDetail }>(`/people/${enc(id)}`),
  follow: (id: string) => post<{ ok: true }>('/follow', { id }),
  unfollow: (id: string) => post<{ ok: true }>('/unfollow', { id }),
  follows: () => call<{ following: Person[]; followers: Person[] }>('/follows'),
  conversations: () => call<{ conversations: Conversation[] }>('/conversations'),
  messages: (id: string, since?: number) => call<{ messages: Message[]; canSend: boolean }>(`/messages/${enc(id)}${since ? `?since=${since}` : ''}`),
  send: (to: string, body: string) => post<{ message: Message }>('/messages', { to, body }),
  markRead: (id: string) => post<{ ok: true }>('/messages/read', { id }),
  unread: () => call<{ unread: number }>('/unread'),
  shares: () => call<{ given: Person[]; received: Person[] }>('/shares'),
  share: (id: string) => post<{ ok: true }>('/shares', { id }),
  revoke: (id: string) => post<{ ok: true }>('/shares/revoke', { id }),
  publishSummary: (summary: Summary) => call<{ ok: true }>('/summary', { method: 'PUT', body: summary }),
  summaryOf: (id: string) => call<{ summary: Summary | null; updatedAt: number | null }>(`/people/${enc(id)}/summary`),
};
