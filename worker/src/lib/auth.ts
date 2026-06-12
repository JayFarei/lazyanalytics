import type { Context, Next } from 'hono';
import type { Env } from '../index';

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i]! ^ bufB[i]!;
  }
  return result === 0;
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  // Refuse to serve anything if the server has no secret configured.
  // This also guarantees an empty-string secret can never pass auth.
  if (!c.env.API_SECRET) {
    return c.json({ error: 'Server not configured: API_SECRET secret is not set. Run: lazyanalytics setup' }, 500);
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'Missing Authorization header' }, 401);
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return c.json({ error: 'Invalid Authorization header format. Expected: Bearer <token>' }, 401);
  }

  const token = parts[1];
  if (!timingSafeEqual(token, c.env.API_SECRET)) {
    return c.json({ error: 'Invalid API token' }, 401);
  }

  await next();
}
