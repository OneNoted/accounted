/**
 * Decide whether an `/api` request should SKIP the middleware MFA (AAL2) gate.
 *
 * Most `/api` routes historically hand-roll `supabase.auth.getUser()` instead
 * of `requireAuth()`, which means they never enforce MFA. The middleware gate
 * (lib/supabase/middleware.ts) closes that gap for cookie sessions, but a few
 * request classes must NOT be gated:
 *
 *   - Bearer-authenticated calls (API keys, cron secret, signed webhooks) carry
 *     no browser MFA session at all — the route validates the token itself.
 *   - The AAL1 escape hatch: a user with MFA required but not yet verified (or a
 *     BankID-only user setting a first password) must still reach
 *     `/api/account/*` and `/api/company*` to COMPLETE onboarding / enroll MFA.
 *   - The MCP OAuth endpoints (`/api/mcp-oauth/*`) carry their own PKCE +
 *     single-use-code security and drive the connector authorize flow.
 *
 * Kept as a pure function so the allowlist is unit-testable in isolation.
 */
export function apiPathSkipsMfaGate(
  pathname: string,
  hasAuthorizationHeader: boolean,
): boolean {
  if (hasAuthorizationHeader) return true
  return (
    pathname.startsWith('/api/account/') ||
    pathname.startsWith('/api/company') ||
    pathname.startsWith('/api/mcp-oauth/')
  )
}
