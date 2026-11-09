// Custom reports by email, requested through the MCP server. The assistant sends STRUCTURED content (headings, paragraphs, metrics,
// tables, bars, lists), never HTML: the server escapes every piece of text and renders it in the Ctrl+Cash look. The only recipient is the
// verified email of the person's own account.
import nodemailer from 'nodemailer';
import { ValidationError } from './validate.js';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** SMTP (any provider: a free tier of Brevo, Resend, Gmail with an app password...). `url` like smtps://user:pass@host:465. */
export function createSmtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url);
  return { send: async (m) => void (await transport.sendMail({ from, to: m.to, subject: m.subject, html: m.html, text: m.text })) };
}

type Tone = 'good' | 'bad' | 'neutral';
export type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'metrics'; items: { label: string; value: string; tone: Tone }[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'bars'; items: { label: string; value: number; display: string }[] }
  | { type: 'list'; items: string[] };

export interface Report {
  subject: string;
  title: string;
  subtitle?: string;
  blocks: Block[];
  note?: string;
}

const MAX_JSON = 80_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function text(v: unknown, name: string, max: number, min = 1): string {
  const s = typeof v === 'number' ? String(v) : v;
  if (typeof s !== 'string') throw new ValidationError(`"${name}" must be text`);
  const clean = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if ([...clean].length < min || [...clean].length > max) throw new ValidationError(`"${name}" must be ${min} to ${max} characters`);
  return clean;
}
function list(v: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw new ValidationError(`"${name}" must be a list of 1 to ${max} items`);
  return v;
}

/** Checks what the assistant sent and turns it into a `Report` (throws ValidationError with a reason). */
export function parseReport(args: Record<string, unknown>): Report {
  if (JSON.stringify(args).length > MAX_JSON) throw new ValidationError('the report is too large');
  const subject = text(args.subject, 'subject', 120).replace(/[\r\n]+/g, ' ');
  const title = text(args.title, 'title', 100);
  const subtitle = args.subtitle === undefined ? undefined : text(args.subtitle, 'subtitle', 200);
  const note = args.note === undefined ? undefined : text(args.note, 'note', 300);
  const blocks: Block[] = list(args.blocks, 'blocks', 40).map((raw, i) => {
    if (!isObj(raw)) throw new ValidationError(`blocks[${i}] must be an object`);
    const at = `blocks[${i}]`;
    switch (raw.type) {
      case 'heading':
        return { type: 'heading', text: text(raw.text, `${at}.text`, 120) };
      case 'paragraph':
        return { type: 'paragraph', text: text(raw.text, `${at}.text`, 2000) };
      case 'metrics':
        return {
          type: 'metrics',
          items: list(raw.items, `${at}.items`, 8).map((m, k) => {
            if (!isObj(m)) throw new ValidationError(`${at}.items[${k}] must be an object`);
            const tone = m.tone === 'good' || m.tone === 'bad' ? m.tone : 'neutral';
            return { label: text(m.label, `${at}.items[${k}].label`, 60), value: text(m.value, `${at}.items[${k}].value`, 40), tone };
          }),
        };
      case 'table': {
        const columns = list(raw.columns, `${at}.columns`, 6).map((c, k) => text(c, `${at}.columns[${k}]`, 40));
        const rows = list(raw.rows, `${at}.rows`, 120).map((r, k) => {
          if (!Array.isArray(r) || r.length !== columns.length) throw new ValidationError(`${at}.rows[${k}] must have ${columns.length} cells`);
          return r.map((c, j) => text(c === null || c === undefined ? '' : c, `${at}.rows[${k}][${j}]`, 120, 0));
        });
        return { type: 'table', columns, rows };
      }
      case 'bars':
        return {
          type: 'bars',
          items: list(raw.items, `${at}.items`, 20).map((b, k) => {
            if (!isObj(b) || typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0) throw new ValidationError(`${at}.items[${k}] needs a label and a value that is a number from 0 up`);
            return { label: text(b.label, `${at}.items[${k}].label`, 60), value: b.value, display: text(b.display ?? String(b.value), `${at}.items[${k}].display`, 40) };
          }),
        };
      case 'list':
        return { type: 'list', items: list(raw.items, `${at}.items`, 30).map((s, k) => text(s, `${at}.items[${k}]`, 300)) };
      default:
        throw new ValidationError(`${at}.type must be heading, paragraph, metrics, table, bars or list`);
    }
  });
  return { subject, title, subtitle, blocks, note };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const nl = (s: string) => esc(s).replace(/\n/g, '<br>');

// the app's own colors (src/theme)
const C = { navy: '#0F1B33', primary: '#2D55D9', bg: '#F3F5F9', card: '#FFFFFF', surface: '#EDF1F8', text: '#0F1B33', muted: '#5B6785', border: '#E3E8F2', good: '#1FA86A', bad: '#E0446A' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const toneColor = (t: Tone) => (t === 'good' ? C.good : t === 'bad' ? C.bad : C.text);

const FOOTERS: Record<string, string> = {
  en: 'Made by Claude at your request, from your Ctrl+Cash data. Only you got this email.',
  pt: 'Feito pelo Claude a seu pedido, com os seus dados do Ctrl+Cash. Só você recebeu este e-mail.',
  es: 'Hecho por Claude a tu petición, con tus datos de Ctrl+Cash. Solo tú recibiste este correo.',
  de: 'Von Claude auf deinen Wunsch aus deinen Ctrl+Cash-Daten erstellt. Nur du hast diese E-Mail erhalten.',
  fr: 'Réalisé par Claude à votre demande, à partir de vos données Ctrl+Cash. Vous seul avez reçu cet e-mail.',
  it: 'Creato da Claude su tua richiesta, con i tuoi dati di Ctrl+Cash. Solo tu hai ricevuto questa email.',
};

function renderBlock(b: Block): { html: string; text: string } {
  switch (b.type) {
    case 'heading':
      return { html: `<tr><td style="padding:22px 28px 6px;font:700 18px ${FONT};color:${C.text}">${esc(b.text)}</td></tr>`, text: `\n${b.text.toUpperCase()}\n` };
    case 'paragraph':
      return { html: `<tr><td style="padding:6px 28px;font:400 16px/1.55 ${FONT};color:${C.text}">${nl(b.text)}</td></tr>`, text: `${b.text}\n` };
    case 'metrics': {
      const cells = b.items.map((m) => `<td style="padding:0 6px 12px;vertical-align:top"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.surface};border-radius:12px"><tr><td style="padding:12px 14px"><div style="font:400 14px ${FONT};color:${C.muted}">${esc(m.label)}</div><div style="font:700 20px ${FONT};color:${toneColor(m.tone)}">${esc(m.value)}</div></td></tr></table></td>`);
      // up to 3 per row
      const rows: string[] = [];
      for (let i = 0; i < cells.length; i += 3) rows.push(`<tr>${cells.slice(i, i + 3).join('')}</tr>`);
      return { html: `<tr><td style="padding:10px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>`, text: `${b.items.map((m) => `${m.label}: ${m.value}`).join('\n')}\n` };
    }
    case 'table': {
      const head = b.columns.map((c, i) => `<th align="${i === 0 ? 'left' : 'right'}" style="padding:8px 10px;font:600 14px ${FONT};color:${C.muted};border-bottom:2px solid ${C.border}">${esc(c)}</th>`).join('');
      const body = b.rows.map((r) => `<tr>${r.map((c, i) => `<td align="${i === 0 ? 'left' : 'right'}" style="padding:9px 10px;font:400 15px ${FONT};color:${C.text};border-bottom:1px solid ${C.border}">${esc(c)}</td>`).join('')}</tr>`).join('');
      return { html: `<tr><td style="padding:8px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${head}</tr>${body}</table></td></tr>`, text: `${b.columns.join(' | ')}\n${b.rows.map((r) => r.join(' | ')).join('\n')}\n` };
    }
    case 'bars': {
      const max = Math.max(...b.items.map((i) => i.value), 1e-9);
      const rows = b.items.map((i) => {
        const w = Math.max(2, Math.round((i.value / max) * 100));
        return `<tr><td style="padding:5px 0 0;font:400 15px ${FONT};color:${C.text}">${esc(i.label)}</td><td align="right" style="padding:5px 0 0;font:600 15px ${FONT};color:${C.text}">${esc(i.display)}</td></tr><tr><td colspan="2" style="padding:3px 0 8px"><div style="background:${C.surface};border-radius:6px;height:10px"><div style="background:${C.primary};border-radius:6px;height:10px;width:${w}%"></div></div></td></tr>`;
      });
      return { html: `<tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table></td></tr>`, text: `${b.items.map((i) => `${i.label}: ${i.display}`).join('\n')}\n` };
    }
    case 'list':
      return { html: `<tr><td style="padding:6px 28px"><ul style="margin:0;padding-left:20px;font:400 16px/1.6 ${FONT};color:${C.text}">${b.items.map((s) => `<li>${nl(s)}</li>`).join('')}</ul></td></tr>`, text: `${b.items.map((s) => `- ${s}`).join('\n')}\n` };
  }
}

/** The email: the Ctrl+Cash header (the dark rounded "C" and the wordmark), the report on a white card, a quiet footer. */
export function renderReport(r: Report, language = 'en', today = ''): { html: string; text: string } {
  const parts = r.blocks.map(renderBlock);
  const footer = FOOTERS[language] ?? FOOTERS.en!;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
<tr><td style="padding:0 6px 14px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.navy};border-radius:9px;width:32px;height:32px;text-align:center;font:700 18px/32px ${FONT};color:#FFFFFF">C</td><td style="padding-left:10px;font:700 18px ${FONT};color:${C.text}">Ctrl+Cash</td></tr></table></td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border-radius:20px;border:1px solid ${C.border}">
<tr><td style="padding:26px 28px 6px"><div style="font:700 24px/1.25 ${FONT};color:${C.text}">${esc(r.title)}</div>${r.subtitle ? `<div style="padding-top:6px;font:400 16px/1.4 ${FONT};color:${C.muted}">${esc(r.subtitle)}</div>` : ''}<div style="height:4px;width:48px;background:${C.primary};border-radius:2px;margin-top:14px"></div></td></tr>
${parts.map((p) => p.html).join('\n')}
${r.note ? `<tr><td style="padding:14px 28px 4px;font:400 14px/1.5 ${FONT};color:${C.muted}">${nl(r.note)}</td></tr>` : ''}
<tr><td style="padding:10px 28px 24px"></td></tr>
</table></td></tr>
<tr><td style="padding:16px 12px;text-align:center;font:400 13px/1.5 ${FONT};color:${C.muted}">${esc(footer)}${today ? `<br>${esc(today)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  const plain = `Ctrl+Cash\n\n${r.title}${r.subtitle ? `\n${r.subtitle}` : ''}\n${parts.map((p) => p.text).join('')}${r.note ? `\n${r.note}\n` : ''}\n--\n${footer}\n`;
  return { html, text: plain };
}
