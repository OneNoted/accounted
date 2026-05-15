/**
 * Webhook URL safety guard.
 *
 * SSRF mitigation for the dispatcher: a webhook receiver URL is supplied by
 * the caller, and the dispatcher POSTs HMAC-signed payloads to it from the
 * Vercel function's network position. Without validation, a malicious
 * caller could direct the dispatcher at internal addresses (cloud metadata
 * endpoints at 169.254.169.254, kube-internal services at 10.x, loopback,
 * etc.) and exfiltrate signed payloads or probe internal infrastructure.
 *
 * Two-layer defense:
 *   1. At create / update time the v1 routes call `assertSafeWebhookUrl`
 *      and reject the request with VALIDATION_ERROR if the URL fails.
 *   2. At dispatch time the dispatcher calls the same helper before each
 *      HTTP request — DNS records can change between creation and
 *      dispatch (rebind attacks, DNS hijack), so the create-time check
 *      alone is insufficient.
 *
 * Errors carry a stable `reason` string so the route can surface a
 * structured details object and the dispatcher can stamp it on the
 * delivery's error column.
 */

import { promises as dns } from 'node:dns'

export type WebhookUrlValidationReason =
  | 'invalid_url'
  | 'non_https_scheme'
  | 'dns_lookup_failed'
  | 'private_address'
  | 'loopback_address'
  | 'link_local_address'
  | 'cgnat_address'
  | 'metadata_address'

export interface WebhookUrlValidationError {
  ok: false
  reason: WebhookUrlValidationReason
  detail: string
}

export interface WebhookUrlValidationOk {
  ok: true
  hostname: string
  resolvedAddress: string
}

export type WebhookUrlValidationResult = WebhookUrlValidationOk | WebhookUrlValidationError

/**
 * Validate that the URL is HTTPS and resolves to a publicly-routable
 * address. Returns a discriminated result rather than throwing so call
 * sites can surface a clean validation error envelope.
 */
export async function validateWebhookUrl(
  rawUrl: string,
  opts?: { lookup?: typeof dns.lookup },
): Promise<WebhookUrlValidationResult> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'invalid_url', detail: 'URL did not parse.' }
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'non_https_scheme',
      detail: `webhook_url must use https:// (got ${parsed.protocol}).`,
    }
  }

  const lookup = opts?.lookup ?? dns.lookup
  let address: string
  try {
    const resolved = await lookup(parsed.hostname, { verbatim: true })
    address = resolved.address
  } catch (err) {
    return {
      ok: false,
      reason: 'dns_lookup_failed',
      detail: `DNS lookup failed for ${parsed.hostname}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const classification = classifyAddress(address)
  if (classification !== 'public') {
    return {
      ok: false,
      reason: classification,
      detail: `Resolved address ${address} for ${parsed.hostname} is not publicly routable (${classification}).`,
    }
  }

  return { ok: true, hostname: parsed.hostname, resolvedAddress: address }
}

type AddressClass =
  | 'public'
  | 'loopback_address'
  | 'private_address'
  | 'link_local_address'
  | 'cgnat_address'
  | 'metadata_address'

/**
 * Map an IPv4 or IPv6 address string to a safety class. Returns 'public'
 * only when the address falls outside every known unsafe range we care
 * about for SSRF prevention.
 */
function classifyAddress(address: string): AddressClass {
  // IPv4
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address)
  if (v4) {
    const o = [v4[1], v4[2], v4[3], v4[4]].map((s) => Number.parseInt(s, 10))
    // Cloud metadata endpoint — explicit class so we surface it distinctly.
    // 169.254.169.254 is AWS/GCP/Azure/Hetzner; classify before the broader
    // 169.254.0.0/16 link-local check.
    if (o[0] === 169 && o[1] === 254 && o[2] === 169 && o[3] === 254) {
      return 'metadata_address'
    }
    if (o[0] === 169 && o[1] === 254) return 'link_local_address'
    if (o[0] === 127) return 'loopback_address'
    if (o[0] === 10) return 'private_address'
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return 'private_address'
    if (o[0] === 192 && o[1] === 168) return 'private_address'
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return 'cgnat_address'
    // 0.0.0.0/8 — "this network", treat as loopback-equivalent.
    if (o[0] === 0) return 'loopback_address'
    return 'public'
  }

  // IPv6 — minimal classification. Lower-case for case-insensitive match.
  const v6 = address.toLowerCase()
  if (v6 === '::1' || v6 === '0:0:0:0:0:0:0:1') return 'loopback_address'
  if (v6 === '::' || v6 === '0:0:0:0:0:0:0:0') return 'loopback_address'
  // ::ffff:0:0/96 — IPv4-mapped IPv6. Re-classify the embedded IPv4.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v6)
  if (mapped) return classifyAddress(mapped[1])
  // fc00::/7 — unique local
  if (/^f[cd]/.test(v6)) return 'private_address'
  // fe80::/10 — link-local
  if (/^fe[89ab]/.test(v6)) return 'link_local_address'
  return 'public'
}

export const __TESTING__ = { classifyAddress }
