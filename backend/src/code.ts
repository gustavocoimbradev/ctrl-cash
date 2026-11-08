// The short public code of a profile: 6 characters from 34 symbols (digits and letters, without I and O).
// Generated with crypto randomness, never sequential, and assigned once.
import { randomInt } from 'node:crypto';

export const DIGITS = '0123456789';
export const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;
export const CODE_RE = /^[0-9A-HJ-NP-Z]{6}$/;

export const isCode = (v: unknown): v is string => typeof v === 'string' && CODE_RE.test(v);

/** Case-insensitive input: the canonical form is upper case. Returns null when it is not a code. */
export const normalizeCode = (v: unknown): string | null => {
  const c = typeof v === 'string' ? v.toUpperCase() : v;
  return isCode(c) ? c : null;
};

export interface CodeSource {
  /** true when the code already belongs to somebody */
  exists: (code: string) => Promise<boolean>;
  /** a uniform random integer in [0, max); injectable for tests */
  random?: (max: number) => number;
  /** how many digits-only codes are tried before the lettered tier (default 20) */
  digitAttempts?: number;
  /** how many codes with at least one letter are tried before giving up (default 100) */
  mixedAttempts?: number;
}

/**
 * First tries digits-only codes (10^6 of them, the nicest to read out loud): up to `digitAttempts` random ones. When every
 * attempt collides it falls back to random codes over the whole alphabet that contain at least one letter. The caller
 * must still handle a unique violation on insert (two requests can pick the same free code at once) and call this again.
 */
export async function generateCode(src: CodeSource): Promise<string> {
  const random = src.random ?? ((max: number) => randomInt(max));
  const pick = (alphabet: string) => Array.from({ length: CODE_LENGTH }, () => alphabet[random(alphabet.length)]!).join('');
  for (let i = 0; i < (src.digitAttempts ?? 20); i++) {
    const code = pick(DIGITS);
    if (!(await src.exists(code))) return code;
  }
  for (let i = 0; i < (src.mixedAttempts ?? 100); i++) {
    let code = pick(CODE_ALPHABET);
    while (/^[0-9]+$/.test(code)) code = pick(CODE_ALPHABET);
    if (!(await src.exists(code))) return code;
  }
  throw new Error('no free code found');
}
