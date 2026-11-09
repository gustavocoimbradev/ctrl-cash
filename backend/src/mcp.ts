// The MCP server (Streamable HTTP, JSON responses): read-only tools over the snapshot of the signed-in person's finances.
import type { FastifyInstance } from 'fastify';
import { publicUrlOf, userOfAccessToken } from './assistant.js';
import { GUIDE } from './assistant-guide.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, addTransactions } from './assistant-write.js';
import type { Pool } from './db.js';
import { ValidationError } from './validate.js';

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER = { name: 'ctrl-cash', title: 'Ctrl+Cash', version: '1.0.0' };

interface Tool {
  name: string;
  description: string;
  /** the part of the snapshot it returns */
  keys: string[];
}

const TOOLS: Tool[] = [
  { name: 'get_overview', description: 'Current balance, card debt, pending commitments, net worth, average monthly income and spending, leftover and runway (months of spending covered by the wealth).', keys: ['overview'] },
  { name: 'get_financial_health', description: 'The financial health score (0 to 1000), its label and its four parts in percent (wealth, debt-free, healthy spending, month result).', keys: ['health'] },
  { name: 'get_monthly_history', description: 'Income, expenses and leftover for each month, from a year back to six months ahead (what is already registered).', keys: ['months'] },
  { name: 'get_spending_by_category', description: 'What was spent in each category, month by month for the last 6 months, with each category\'s tone (healthy, necessary, comfort, luxury, unhealthy, unknown).', keys: ['categories'] },
  { name: 'get_cards_and_limits', description: 'Each credit card: limit, used, available and due day.', keys: ['cards'] },
  { name: 'get_debts', description: 'Everything owed: card items (installments or not) and the Debts category, what falls due this month and how the debts evolve month by month. Money lent on a card is not included.', keys: ['debts'] },
  { name: 'get_subscriptions_and_bills', description: 'Subscriptions and utility bills: what each costs per month, the totals per month and per year.', keys: ['subscriptions', 'bills'] },
  { name: 'get_delivery', description: 'Delivery spending: the monthly average of the last 3 months, per year, and the orders by date.', keys: ['delivery'] },
  { name: 'get_recent_transactions', description: 'The most recent transactions (date, type, description, amount, category, whether it is confirmed).', keys: ['recent'] },
  { name: 'list_categories_and_cards', description: 'The categories (built-in and the person\'s own, for expenses and for income) and the registered cards, with the exact names to use when adding a transaction.', keys: [] },
  { name: 'add_transaction', description: 'Adds a transaction for the person (only when they allowed adding in Ctrl+Cash). Confirm amount, date, category and card with the person before calling. It never edits or removes anything.', keys: [] },
  { name: 'get_guide', description: 'How Ctrl+Cash works and how to answer the person well. Read it once at the start.', keys: [] },
];

const ADD_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['expense', 'income'] },
    description: { type: 'string', description: 'What it was, 1 to 100 characters, in the person\'s words (for example "Pharmacy").' },
    amount: { type: 'number', description: 'Positive, in whole units of the currency, like 49.90. The total when in installments.' },
    date: { type: 'string', description: 'YYYY-MM-DD, the day it happened (use `today` from the data when it is today).' },
    category: { type: 'string', description: 'A category slug or name; see list_categories_and_cards. Expenses default to Other; income needs one.' },
    confirmed: { type: 'boolean', description: 'true when it already happened (paid or received), false when it is still to come. Default true. Card purchases are always pending.' },
    card: { type: 'string', description: 'The name of the credit card, for a card purchase.' },
    installments: { type: 'integer', minimum: 1, maximum: 48, description: 'Number of monthly installments (default 1).' },
    fixed: { type: 'boolean', description: 'true for something that repeats every month (rent, a subscription).' },
    invoice: { type: 'string', enum: ['next', 'open'], description: 'For a card purchase: the invoice after the open one (default, where purchases usually land) or the open one.' },
  },
  required: ['type', 'description', 'amount'],
  additionalProperties: false,
};

const WRITE_TOOLS = new Set(['add_transaction']);

const toolDef = (t: Tool) =>
  WRITE_TOOLS.has(t.name)
    ? { name: t.name, description: t.description, inputSchema: ADD_SCHEMA, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }
    : { name: t.name, description: t.description, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export function registerMcp(app: FastifyInstance, pool: Pool, publicUrl?: string) {
  async function handle(msg: Rpc, who: { userId: string; canWrite: boolean }): Promise<object | null> {
    const userId = who.userId;
    const { id, method, params } = msg;
    if (typeof method !== 'string' || msg.jsonrpc !== '2.0') return fail(id, -32600, 'Invalid request');
    // notifications have no id and get no answer
    if (id === undefined) return null;
    switch (method) {
      case 'initialize': {
        const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
        return reply(id, { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: GUIDE });
      }
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS.map(toolDef) });
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === params?.name);
        if (!tool) return fail(id, -32602, 'Unknown tool');
        if (tool.name === 'get_guide') return reply(id, { content: [{ type: 'text', text: GUIDE }] });
        const text = (t: string, isError = false) => reply(id, { content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
        if (tool.name === 'list_categories_and_cards') {
          const cats = await pool.query('select slug, kind, name, archived_at_ms from categories where user_id = $1', [userId]);
          const cards = await pool.query('select name, due_day from cards where user_id = $1 and archived_at_ms is null order by created_at_ms nulls last', [userId]);
          const list = (kind: 'expense' | 'income', builtin: Record<string, string>) => [
            ...Object.entries(builtin).filter(([slug]) => !cats.rows.some((r) => r.kind === kind && r.slug === slug && r.archived_at_ms !== null)).map(([slug, name]) => ({ slug, name })),
            ...cats.rows.filter((r) => r.kind === kind && !(r.slug in builtin) && r.archived_at_ms === null).map((r) => ({ slug: r.slug as string, name: r.name as string })),
          ];
          return text(JSON.stringify({ expenseCategories: list('expense', EXPENSE_CATEGORIES), incomeCategories: list('income', INCOME_CATEGORIES), cards: cards.rows.map((r) => ({ name: r.name, dueDay: Number(r.due_day) })) }));
        }
        if (tool.name === 'add_transaction') {
          if (!who.canWrite) return text('This connection is read-only. The person can allow adding transactions in Ctrl+Cash, in Ask Claude (or Account settings), then you can try again.', true);
          const snap = await pool.query("select snapshot->>'today' as today from assistant_snapshots where user_id = $1", [userId]);
          const today = (snap.rows[0]?.today as string | undefined) ?? new Date().toISOString().slice(0, 10);
          try {
            return text(await addTransactions(pool, userId, (params?.arguments ?? {}) as Record<string, unknown>, today));
          } catch (e) {
            if (e instanceof ValidationError) return text(`Not added: ${e.message}`, true);
            throw e;
          }
        }
        const res = await pool.query('select snapshot, updated_at_ms from assistant_snapshots where user_id = $1', [userId]);
        const row = res.rows[0];
        if (!row) {
          return reply(id, { content: [{ type: 'text', text: 'There is no data yet. Ask the person to open Ctrl+Cash once, so the app can publish their finances for you, then try again.' }] });
        }
        const snap = row.snapshot as Record<string, unknown>;
        const out: Record<string, unknown> = { currency: snap.currency, generatedAt: snap.generatedAt, today: snap.today };
        for (const k of tool.keys) out[k] = snap[k] ?? null;
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out) }] });
      }
      default:
        return fail(id, -32601, 'Method not found');
    }
  }

  app.post('/api/mcp', async (req, rep) => {
    const who = await userOfAccessToken(pool, req.headers.authorization);
    if (!who) {
      return rep
        .code(401)
        .header('WWW-Authenticate', `Bearer resource_metadata="${publicUrlOf(req, publicUrl)}/.well-known/oauth-protected-resource/api/mcp"`)
        .send({ error: 'unauthorized' });
    }
    const body = req.body;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.slice(0, 20).map((m) => handle(m as Rpc, who)))).filter((x): x is object => x !== null);
      return out.length ? out : rep.code(202).send();
    }
    if (typeof body !== 'object' || body === null) return rep.code(400).send(fail(null, -32700, 'Parse error'));
    const out = await handle(body as Rpc, who);
    return out ?? rep.code(202).send();
  });

  // a server-initiated stream is not offered: every answer comes in the response to the POST
  app.get('/api/mcp', async (_req, rep) => rep.code(405).header('Allow', 'POST').send({ error: 'method_not_allowed' }));
}
