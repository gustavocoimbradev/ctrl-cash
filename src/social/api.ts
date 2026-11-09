import { call } from '../store/sync';
import type { Tone } from '../types';

/** The social layer of the API (profiles, follows, messages and the shared summary). People are identified by a short code (6 characters, also the one in the profile URL), never by the account id. */

/** A person as other people see them. `code` is the short code people type to find them. */
export interface Person {
  code: string;
  displayName: string;
  color: string | null;
  /** a small square JPEG as a data URL */
  photo: string | null;
}
/** `discoverable`: shown in the people list of the new-chat screen */
export interface MyProfile extends Person {
  discoverable?: boolean;
}

/** Somebody in the people list; `related` = I already talk to them or share with them (they come first). */
export interface ListedPerson extends Person {
  related: boolean;
}
export interface PersonDetail extends Person {
  self: boolean;
  /** I can read their summary now */
  summaryAccess: boolean;
  /** I currently share mine with them */
  sharedWithThem: boolean;
  /** they currently share theirs with me */
  sharesWithMe: boolean;
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
  /** how its owner classed it (healthy, necessary, comfort, luxury, unhealthy); older snapshots have none */
  tone?: Tone;
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
  /** `incomeRel`: the month's income as a % of the person's average month (100 = average); older snapshots may lack it */
  months: { key: string; spent: number; saved: number; incomeRel?: number; categories: CategoryShare[] }[];
  /** overall spending by category, % of income, biggest first */
  categories: CategoryShare[];
  /** the financial health score (0 to 1000) and how full each of its parts is, in percent; absent in older snapshots */
  /** the current month day by day, as cumulative percent of that month's income (income that came in, spending so far) */
  days?: { month: string; income: number[]; spent: number[] };
  health?: { score: number; label: 'Critical' | 'Warning' | 'Good' | 'Excellent'; wealth: number; debt: number; habits: number; month: number };
  /** wealth projection as the percent change from today's, 24 months from `start`; never an amount */
  wealth?: { start: string; planned: number[]; habit: number[] };
}

/** The body of the chat message that asks somebody to share their data: the screen shows it as a card with a button, in the reader's language. */
export const SHARE_REQUEST = '[share-request]';

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body });
const enc = encodeURIComponent;

export const socialApi = {
  profile: () => call<{ profile: MyProfile | null }>('/profile'),
  saveProfile: (p: { displayName: string; color?: string; /** a data URL sets it, null clears it, absent leaves it */ photo?: string | null; discoverable?: boolean }) => call<{ profile: MyProfile }>('/profile', { method: 'PUT', body: p }),
  /** the people list: people I know first, then everybody who can be found; `q` is part of a name or a code */
  people: (q: string, offset = 0) => call<{ people: ListedPerson[]; more: boolean }>(`/people?q=${enc(q)}&offset=${offset}`),
  /** who a code belongs to (404 when nobody) */
  person: (code: string) => call<{ person: PersonDetail }>(`/people/${enc(code)}`),
  conversations: () => call<{ conversations: Conversation[] }>('/conversations'),
  messages: (code: string, since?: number) => call<{ messages: Message[]; canSend: boolean }>(`/messages/${enc(code)}${since ? `?since=${since}` : ''}`),
  send: (to: string, body: string) => post<{ message: Message }>('/messages', { to, body }),
  markRead: (code: string) => post<{ ok: true }>('/messages/read', { code }),
  unread: () => call<{ unread: number }>('/unread'),
  shares: () => call<{ given: Person[]; received: Person[] }>('/shares'),
  share: (code: string) => post<{ ok: true }>('/shares', { code }),
  revoke: (code: string) => post<{ ok: true }>('/shares/revoke', { code }),
  publishSummary: (summary: Summary) => call<{ ok: true }>('/summary', { method: 'PUT', body: summary }),
  summaryOf: (code: string) => call<{ summary: Summary | null; updatedAt: number | null }>(`/people/${enc(code)}/summary`),
};
