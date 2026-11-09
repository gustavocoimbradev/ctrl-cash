// Account preferences (language and currency) and the visitor's region, used to suggest a currency.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from './db.js';
import { ValidationError } from './validate.js';

type Authn = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export const LANGUAGES = ['en', 'pt', 'es', 'de', 'fr', 'it'] as const;

export interface SettingsInput {
  language: (typeof LANGUAGES)[number];
  currency: string;
}

export function parseSettings(input: unknown): SettingsInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new ValidationError('the body must be an object');
  const d = input as Record<string, unknown>;
  for (const k of Object.keys(d)) if (k !== 'language' && k !== 'currency') throw new ValidationError(`unknown field "${k}"`);
  if (typeof d.language !== 'string' || !(LANGUAGES as readonly string[]).includes(d.language)) throw new ValidationError('"language" must be one of ' + LANGUAGES.join(', '));
  if (typeof d.currency !== 'string' || !/^[A-Z]{3}$/.test(d.currency)) throw new ValidationError('"currency" must be a 3 letter code like USD');
  return { language: d.language as SettingsInput['language'], currency: d.currency };
}

/**
 * The visitor's country as the edge network reports it (Cloudflare's `CF-IPCountry`, or the same header from another
 * proxy). The IP address itself is never read, stored or sent anywhere. Unknown or missing -> null.
 */
export function countryOf(headers: FastifyRequest['headers']): string | null {
  const raw = headers['cf-ipcountry'] ?? headers['x-vercel-ip-country'] ?? headers['x-country-code'];
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  // XX = unknown, T1 = Tor
  return v && /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1' ? v : null;
}

export function registerSettings(app: FastifyInstance, pool: Pool, authenticate: Authn) {
  app.route({
    method: 'GET',
    url: '/api/settings',
    onRequest: authenticate,
    handler: async (req) => {
      const res = await pool.query('select language, currency from settings where user_id = $1', [req.uid]);
      return { settings: res.rows[0] ? { language: res.rows[0].language as string, currency: res.rows[0].currency as string } : null };
    },
  });

  app.route({
    method: 'PUT',
    url: '/api/settings',
    onRequest: authenticate,
    handler: async (req, reply) => {
      let s: SettingsInput;
      try {
        s = parseSettings(req.body);
      } catch (e) {
        if (e instanceof ValidationError) return reply.code(400).send({ error: 'invalid', message: e.message });
        throw e;
      }
      await pool.query(
        `insert into settings (user_id, language, currency) values ($1, $2, $3)
         on conflict (user_id) do update set language = excluded.language, currency = excluded.currency, updated_at = now()`,
        [req.uid, s.language, s.currency],
      );
      return { settings: s };
    },
  });

  app.route({
    method: 'GET',
    url: '/api/region',
    onRequest: authenticate,
    handler: async (req) => ({ country: countryOf(req.headers) }),
  });
}
