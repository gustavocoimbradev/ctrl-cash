// The tools of the MCP server that are not plain reads of the snapshot. Each one says what it needs (`scope`): `write` is changing
// the person's own finances, `social` is acting on their profile, sharing and messages. A connection only gets what the person
// allowed; everything done is logged for them (assistant_actions) and nothing is ever deleted: removing archives.
import type { Pool } from './db.js';
import { addTransactions } from './assistant-write.js';
import { parseReport, renderReport, type Mailer } from './email-report.js';
import { ValidationError } from './validate.js';
import { dataTools } from './tools-data.js';
import { socialTools } from './tools-social.js';

export type Scope = 'read' | 'write' | 'social' | 'email';

export interface ToolCtx {
  pool: Pool;
  userId: string;
  connectionId: string;
  /** the person's today (from their last snapshot, else the server's) */
  today: string;
  /** the site's public address */
  publicUrl: string;
  /** the verified address of the person's own account, kept when they allowed emailing; the only place a report can go */
  email: string | null;
  /** the mail sender (null when email is not set up) */
  mailer: Mailer | null;
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

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'The email subject, up to 120 characters.' },
    title: { type: 'string', description: 'The big title of the report, up to 100 characters.' },
    subtitle: { type: 'string', description: 'Optional line under the title, like the period covered.' },
    blocks: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      description: 'The report, top to bottom. Plain text only (no HTML): the server escapes it and gives it the Ctrl+Cash look.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['heading', 'paragraph', 'metrics', 'table', 'bars', 'list'] },
          text: { type: 'string', description: 'heading / paragraph: the text.' },
          items: { description: 'metrics: [{label, value, tone?: good|bad|neutral}] (up to 8). bars: [{label, value (number >= 0), display (the text shown, like "$ 120.00")}] (up to 20). list: [text] (up to 30).', type: 'array' },
          columns: { type: 'array', items: { type: 'string' }, description: 'table: up to 6 column titles.' },
          rows: { type: 'array', items: { type: 'array' }, description: 'table: rows of cells, each as long as columns (up to 120 rows). Cells are text: format money yourself.' },
        },
        required: ['type'],
      },
    },
    note: { type: 'string', description: 'Optional small note at the end.' },
  },
  required: ['subject', 'title', 'blocks'],
  additionalProperties: false,
};

const MAIL_PER_HOUR = 3;
const MAIL_PER_DAY = 10;

const sendReportEmail: McpTool = {
  name: 'send_report_email',
  description: 'Emails the person a custom report (their spending this week, what they spent on fast food, a monthly review...) in the Ctrl+Cash look. It goes ONLY to the email of their own account. Build the numbers first with the reading tools, format money in the text, and keep it short and useful. Does not stop you from also making a PDF or a spreadsheet in the chat.',
  inputSchema: REPORT_SCHEMA,
  scope: 'email',
  handler: async (ctx, args) => {
    if (!ctx.mailer) throw new ValidationError('email is not set up on this server');
    if (!ctx.email) throw new ValidationError('there is no verified email on the person\'s account; ask them to allow emailing again in Ctrl+Cash');
    const report = parseReport(args);
    const now = Date.now();
    const sent = await ctx.pool.query(
      `select count(*) filter (where created_at_ms > $3)::int as hour, count(*)::int as day from assistant_actions where user_id = $1 and tool = 'send_report_email' and created_at_ms > $2`,
      [ctx.userId, now - 86_400_000, now - 3_600_000],
    );
    if ((sent.rows[0]?.hour as number) >= MAIL_PER_HOUR) throw new ValidationError(`at most ${MAIL_PER_HOUR} emails an hour; try again later`);
    if ((sent.rows[0]?.day as number) >= MAIL_PER_DAY) throw new ValidationError(`at most ${MAIL_PER_DAY} emails a day; try again tomorrow`);
    const lang = ((await ctx.pool.query('select language from settings where user_id = $1', [ctx.userId])).rows[0]?.language as string | undefined) ?? 'en';
    const { html, text } = renderReport(report, lang, ctx.today);
    try {
      await ctx.mailer.send({ to: ctx.email, subject: `Ctrl+Cash: ${report.subject}`, html, text });
    } catch {
      throw new ValidationError('the email could not be sent right now; try again later');
    }
    const [name = '', domain = ''] = ctx.email.split('@');
    return `Email sent to ${name.slice(0, 1)}***@${domain}: "${report.subject}".`;
  },
};

/** Every tool that is not a plain read of the snapshot. */
export const REGISTRY: McpTool[] = [addTransaction, sendReportEmail, ...dataTools, ...socialTools];

export const toolByName = (name: unknown): McpTool | undefined => REGISTRY.find((t) => t.name === name);
