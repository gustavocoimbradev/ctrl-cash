// The tools of the MCP server that are not plain reads of the snapshot. Each one says what it needs (`scope`): `write` is changing
// the person's own finances, `social` is acting on their profile, sharing and messages. A connection only gets what the person
// allowed; everything done is logged for them (assistant_actions) and nothing is ever deleted: removing archives.
import type { Pool } from './db.js';
import { addTransactions } from './assistant-write.js';
import { dataTools } from './tools-data.js';
import { socialTools } from './tools-social.js';

export type Scope = 'read' | 'write' | 'social';

export interface ToolCtx {
  pool: Pool;
  userId: string;
  connectionId: string;
  /** the person's today (from their last snapshot, else the server's) */
  today: string;
  /** the site's public address */
  publicUrl: string;
}

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments */
  inputSchema: Record<string, unknown>;
  scope: Scope;
  /** returns the text the assistant reads; a refusal is a thrown ValidationError (becomes "Not done: ...") */
  handler: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<string>;
}

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
    fixed: { type: 'boolean', description: 'true for something that repeats every month (rent, a subscription, a salary).' },
    invoice: { type: 'string', enum: ['next', 'open'], description: 'For a card purchase: the invoice after the open one (default, where purchases usually land) or the open one.' },
  },
  required: ['type', 'description', 'amount'],
  additionalProperties: false,
};

const addTransaction: McpTool = {
  name: 'add_transaction',
  description: 'Adds a transaction (an expense or income, one-time, monthly or in installments, on the account or on a card). Confirm amount, date, category and card with the person before calling.',
  inputSchema: ADD_SCHEMA,
  scope: 'write',
  handler: (ctx, args) => addTransactions(ctx.pool, ctx.userId, args, ctx.today),
};

/** Every tool that is not a plain read of the snapshot. */
export const REGISTRY: McpTool[] = [addTransaction, ...dataTools, ...socialTools];

export const toolByName = (name: unknown): McpTool | undefined => REGISTRY.find((t) => t.name === name);
