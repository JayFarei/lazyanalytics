/**
 * Generate an approximate daily visitor hash.
 * Uses site + IP + User-Agent + date + a per-deployment secret salt (HASH_SALT)
 * to produce a non-reversible identifier.
 * Site is included to prevent cross-site visitor correlation; the secret salt
 * prevents offline rainbow-table reversal of IP+UA combinations.
 * This is an approximation, not identity. Named accordingly in API responses.
 */
export async function hashVisitor(
  site: string,
  ip: string,
  ua: string,
  date: string,
  salt: string,
): Promise<string> {
  const data = new TextEncoder().encode(`${site}|${ip}|${ua}|${date}|${salt}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  // Truncate to 32 hex chars (16 bytes) for index1 efficiency
  return Array.from(hashArray.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Get today's date string in YYYY-MM-DD format (UTC) */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}
