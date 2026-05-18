import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClientNoCookies } from './api-keys'

/**
 * Built-in redirect URI patterns. These bypass the DB lookup entirely so
 * Claude's connector keeps working without seeded rows, and so local
 * development never depends on having a registration.
 */
export const BUILT_IN_REDIRECT_PATTERNS: readonly RegExp[] = [
  /^https:\/\/claude\.ai\/api\//,
  /^https:\/\/claude\.com\/api\//,
  /^http:\/\/localhost(:\d+)?(\/|$)/,
  /^http:\/\/127\.0\.0\.1(:\d+)?(\/|$)/,
]

export function isBuiltInRedirectUri(uri: string): boolean {
  return BUILT_IN_REDIRECT_PATTERNS.some((pattern) => pattern.test(uri))
}

/**
 * Resolve whether a redirect URI is allowed. Built-in patterns short-circuit;
 * otherwise we look for a non-revoked registration in oauth_client_registrations.
 *
 * Uses the service role client because the /register and /authorize endpoints
 * may run without a user session (dynamic client registration is anonymous).
 * The lookup is by exact URI — the unique partial index on the table ensures
 * at most one active row.
 */
export async function isAllowedRedirectUri(
  uri: string,
  supabase?: SupabaseClient
): Promise<boolean> {
  if (typeof uri !== 'string' || uri.length === 0) return false
  if (isBuiltInRedirectUri(uri)) return true

  // Service-role client construction can throw when Supabase env vars are
  // absent (unit tests, misconfigured deploys). Treat that as "not allowed"
  // — failing closed is the safe default for an allowlist.
  let client: SupabaseClient
  try {
    client = supabase ?? createServiceClientNoCookies()
  } catch {
    return false
  }

  const { data, error } = await client
    .from('oauth_client_registrations')
    .select('id')
    .eq('redirect_uri', uri)
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle()

  if (error) return false
  return data !== null
}
