/**
 * Common security headers for public v1 responses.
 *
 * Applied to discovery routes (`/llms.txt`, `/.well-known/skills/index.json`,
 * `/api/v1/openapi.json`) that bypass the auth wrapper.
 *
 * The wrapped routes don't need these explicitly: NextResponse's defaults +
 * the auth wrapper's stamping cover them. Public routes are an exception
 * because they're plain `NextResponse.json/text` returns with caching.
 *
 *   X-Content-Type-Options: nosniff   — block MIME sniffing on text/json
 *   Referrer-Policy: strict-origin... — limit referrer leakage if a link is
 *                                       embedded somewhere unexpected
 *   X-Frame-Options: DENY             — discovery surfaces should never
 *                                       legitimately render in a frame
 */

export const PUBLIC_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
}

/**
 * Merge the public security headers onto an arbitrary header dict so callers
 * can keep their own Content-Type / Cache-Control entries.
 */
export function withPublicSecurityHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...PUBLIC_SECURITY_HEADERS, ...extra }
}
