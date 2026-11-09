import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createPool, type Pool } from '../db.js';
import { migrate } from '../migrate.js';
import type { Doc } from '../validate.js';

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:pg@localhost:55432/postgres';

export async function setup(extra: Partial<Parameters<typeof buildApp>[0]> = {}): Promise<{ pool: Pool; app: FastifyInstance }> {
  const pool = createPool(DATABASE_URL);
  await migrate(pool);
  // fake verifier: the token "tok:<uid>" belongs to <uid>
  const app = await buildApp({
    pool,
    rateLimitMax: 100000,
    ...extra,
    verify: async (t) => {
      if (!t.startsWith('tok:')) throw new Error('bad token');
      // `tok:<uid>` or `tok:<uid>|<email>` (a verified address)
      const [uid, email] = t.slice(4).split('|');
      return { uid: uid!, ...(email ? { email } : {}) };
    },
  });
  return { pool, app };
}

export const newUid = () => `u-${randomUUID()}`;
export const bearer = (uid: string) => ({ authorization: `Bearer tok:${uid}` });

export const tx = (over: Doc = {}): Doc => ({
  id: 't1', type: 'expense', description: 'Groceries', amount: 5000, date: '2026-10-30',
  confirmed: true, fixed: false, confirmedMonths: [], ...over,
});

export const samples: Record<string, Doc> = {
  transactions: tx(),
  cards: { id: 'x1', name: 'Card', limit: 100000, dueDay: 10 },
  payments: { id: 'x1', cardId: 'c1', invoiceKey: '2026-11', amount: 5000, date: '2026-11-10' },
  reserves: { id: 'x1', name: 'Trip' },
  reserveMoves: { id: 'x1', reserveId: 'r1', type: 'deposit', amount: 5000, date: '2026-11-10' },
  categories: { id: 'x1', slug: 'x1', kind: 'expense', name: 'Coffee', weight: 0.45 },
  shoppingLists: { id: 'x1', name: 'Weekly', items: [{ id: 'i1', name: 'Milk', done: false }] },
  wishlist: { id: 'x1', name: 'Headphones' },
};

export const full: Record<string, Doc> = {
  transactions: tx({
    id: 'f1', fixed: true, confirmedMonths: ['2026-10', '2026-11'], cardId: 'c1', invoiceKey: '2026-11', category: 'shopping',
    installment: { index: 1, total: 3, groupId: 'g1' }, createdAt: 1790000000000, archivedAt: 1790000001000, source: 'claude',
    revisions: [{ from: '2026-12', amount: 12000 }], overrides: { '2026-11': { amount: 9000, day: 5 } },
  }),
  cards: { id: 'c1', name: 'Nubank', limit: 500000, dueDay: 9, color: '#8B3FD9', createdAt: 1790000000000, archivedAt: 1790000001000, source: 'claude' },
  payments: { id: 'p1', cardId: 'c1', invoiceKey: '2026-11', amount: 1000, date: '2026-11-05', archivedAt: 1790000001000, source: 'claude' },
  reserves: { id: 'r1', name: 'Trip', goal: 500000, createdAt: 1790000000000, archivedAt: 1790000001000 },
  reserveMoves: { id: 'm1', reserveId: 'r1', type: 'withdraw', amount: 100, date: '2026-10-31', confirmed: false, createdAt: 1790000000001, archivedAt: 1790000001000 },
  shoppingLists: { id: 's1', name: 'Weekly ☕', items: [{ id: 'i1', name: 'Milk', done: true }, { id: 'i2', name: 'Eggs', done: false, archivedAt: 1790000001000 }], finishedAt: 1790000000500, createdAt: 1790000000000, archivedAt: 1790000001000 },
  wishlist: { id: 'w1', name: 'Headphones ☕', price: 25000, url: 'https://example.com/p?id=1', note: 'the black ones', boughtAt: 1790000000500, createdAt: 1790000000000, archivedAt: 1790000001000 },
  categories: { id: 'income_salary', slug: 'salary', kind: 'expense', name: 'Pay', weight: 0.25, createdAt: 1790000000000, archivedAt: 1790000001000, source: 'claude' },
};
