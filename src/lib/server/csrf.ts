/**
 * CSRF for admin forms: a synchronizer token = HMAC(CSRF_SECRET, email|day), rendered into every admin form
 * and checked on every admin POST together with a same-origin check. Stateless (no cookie, no DB row).
 */
import { getEnv, isLocal } from './env';
import { hmacHex, sameOrigin, timingSafeEqual } from './http';

function secret(): string | null {
  const e = getEnv();
  if (e.CSRF_SECRET) return e.CSRF_SECRET;
  return isLocal(e) ? 'local-dev-csrf-secret' : null;
}

function day(offset = 0): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

export async function csrfToken(email: string): Promise<string> {
  const s = secret();
  if (!s) throw new Error('CSRF_SECRET missing');
  return hmacHex(s, `${email}|${day()}`);
}

export async function verifyCsrf(request: Request, email: string, token: string | null | undefined): Promise<boolean> {
  if (!sameOrigin(request)) return false;
  const s = secret();
  if (!s || !token) return false;
  for (const off of [0, -1]) {
    if (timingSafeEqual(await hmacHex(s, `${email}|${day(off)}`), token)) return true;
  }
  return false;
}
