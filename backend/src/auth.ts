import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** `email` is only given when the account's address is verified. */
export type Verifier = (token: string) => Promise<{ uid: string; email?: string }>;

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

function issuerOf(projectId: string): string {
  return `https://securetoken.google.com/${projectId}`;
}

/** Verifies a real Firebase ID token (RS256, signed by Google). `jwks` is injectable for tests. */
export function createFirebaseVerifier(projectId: string, jwks?: JWTVerifyGetKey): Verifier {
  const keys = jwks ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer: issuerOf(projectId),
      audience: projectId,
      algorithms: ['RS256'],
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('missing sub');
    const email = typeof payload.email === 'string' && payload.email_verified === true ? payload.email : undefined;
    return { uid: payload.sub, ...(email ? { email } : {}) };
  };
}

/** Local development only: the Auth emulator issues unsigned tokens, so we only decode them. */
export function createEmulatorVerifier(projectId: string): Verifier {
  return async (token) => {
    const p = decodeJwt(token);
    if (p.iss !== issuerOf(projectId)) throw new Error('bad issuer');
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!aud.includes(projectId)) throw new Error('bad audience');
    if (typeof p.exp !== 'number' || p.exp * 1000 <= Date.now()) throw new Error('expired');
    if (typeof p.sub !== 'string' || p.sub.length === 0) throw new Error('missing sub');
    return { uid: p.sub, ...(typeof p.email === 'string' ? { email: p.email } : {}) };
  };
}
