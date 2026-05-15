/**
 * Webhook delivery dispatcher.
 *
 * Invoked from the per-minute cron at /api/webhooks/dispatch/cron. Picks up
 * pending + retry-due deliveries (FOR UPDATE SKIP LOCKED so multiple cron
 * invocations don't double-deliver), POSTs each one with HMAC signature,
 * and updates the row to one of:
 *
 *   - delivered (2xx response)         — terminal
 *   - failed   (5xx / network / 4xx    — non-terminal until attempts
 *               other than 410)         exhausted; bumps next_attempt_at
 *               by exponential backoff
 *   - dead     (HTTP 410 OR             — terminal
 *               attempts exhausted)
 *
 * The receiver is expected to respond within 10 seconds; we time out
 * aggressively so a slow receiver doesn't block the per-minute cron.
 *
 * On HTTP 410 we additionally disable the webhook (sets disabled_at +
 * disabled_reason='HTTP 410 from receiver') so future events don't even
 * enqueue against it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { signPayload } from './signing'
import { validateWebhookUrl } from './url-guard'
import { createLogger } from '@/lib/logger'

const log = createLogger('webhooks/dispatcher')

/** 7 retries over ~72h. Index = attempts BEFORE this one. */
const RETRY_BACKOFF_SECONDS: ReadonlyArray<number> = [
  60,        //  1m  — first retry
  5 * 60,    //  5m
  30 * 60,   // 30m
  2 * 60 * 60,   //  2h
  12 * 60 * 60,  // 12h
  24 * 60 * 60,  // 24h
  48 * 60 * 60,  // 48h — final retry
]

const MAX_ATTEMPTS = RETRY_BACKOFF_SECONDS.length + 1 // initial + 7 retries = 8 total
const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BODY_BYTES = 4096

interface DueDelivery {
  id: string
  webhook_id: string
  company_id: string
  event_type: string
  payload: Record<string, unknown>
  previous_attributes: Record<string, unknown> | null
  api_version: string
  attempts: number
}

interface WebhookForDelivery {
  id: string
  company_id: string
  webhook_url: string
  secret: string
}

export interface DispatchSummary {
  picked: number
  delivered: number
  failed: number
  dead: number
}

/**
 * Run one dispatch cycle. Picks up to `batchSize` due deliveries and
 * processes them sequentially (the per-minute cadence + small batch size
 * makes parallelism unnecessary; in-process serial is also gentler on the
 * receiver if many events fan out to the same URL).
 */
export async function dispatchDueDeliveries(args: {
  supabase: SupabaseClient
  /** Max rows to claim per cron tick. Default 50. */
  batchSize?: number
  /** Override for tests. */
  now?: Date
  /** Override for tests; injected fetch implementation. */
  fetchImpl?: typeof fetch
}): Promise<DispatchSummary> {
  const batchSize = args.batchSize ?? 50
  const now = args.now ?? new Date()
  const fetchImpl = args.fetchImpl ?? fetch

  const summary: DispatchSummary = { picked: 0, delivered: 0, failed: 0, dead: 0 }

  // Recover stuck in_flight rows: a previous tick that was killed mid-flight
  // (Vercel function timeout, hard crash, manual termination) leaves rows
  // marked in_flight forever otherwise. Sweep them back to 'failed' so the
  // retry loop picks them up at next_attempt_at.
  //
  // Threshold = 2× REQUEST_TIMEOUT_MS. A live attempt takes at most
  // REQUEST_TIMEOUT_MS plus the body read; doubling that gives an
  // unambiguous "this is stuck, not in-flight" boundary.
  await recoverStuckInFlight(args.supabase, now)

  const due = await claimDueDeliveries(args.supabase, batchSize, now)
  summary.picked = due.length
  if (due.length === 0) return summary

  // Dedupe webhook lookups within a single cycle.
  const webhookIds = Array.from(new Set(due.map((d) => d.webhook_id)))
  const webhookMap = await loadWebhooksByIds(args.supabase, webhookIds)

  for (const delivery of due) {
    const webhook = webhookMap.get(delivery.webhook_id)
    if (!webhook) {
      // The webhook was deleted between enqueue and dispatch. Mark dead;
      // there's no receiver to deliver to. The webhook_deliveries.webhook_id
      // FK is ON DELETE SET NULL (migration 20260515170000), so the row
      // stays in the audit trail under status='dead'.
      await markDead(args.supabase, delivery.id, 'webhook_deleted')
      summary.dead++
      continue
    }

    // Defense-in-depth tenancy check: the webhook the delivery row points
    // at MUST belong to the same company as the delivery row. Mismatch
    // indicates a poisoned row — refuse to dispatch (which would sign with
    // the wrong tenant's secret and POST to the wrong receiver).
    if (webhook.company_id !== delivery.company_id) {
      log.error('cross-tenant delivery refused', new Error('company_id mismatch'), {
        deliveryId: delivery.id,
        deliveryCompanyId: delivery.company_id,
        webhookId: webhook.id,
        webhookCompanyId: webhook.company_id,
      })
      await markDead(args.supabase, delivery.id, 'cross_tenant_mismatch')
      summary.dead++
      continue
    }

    const outcome = await attemptDelivery({
      delivery,
      webhook,
      fetchImpl,
      now,
    })

    // Structured per-delivery outcome log. Keeps companyId / webhookId /
    // deliveryId available in log aggregation for per-tenant audit-trail
    // reconstruction without grepping through individual mark*-helper
    // writes (V16 — security event correlation).
    const logCtx = {
      deliveryId: delivery.id,
      webhookId: webhook.id,
      companyId: delivery.company_id,
      eventType: delivery.event_type,
      attempt: delivery.attempts + 1,
    }

    switch (outcome.kind) {
      case 'delivered':
        await markDelivered(args.supabase, delivery.id, outcome)
        log.info('delivery succeeded', { ...logCtx, responseStatus: outcome.responseStatus })
        summary.delivered++
        break
      case 'dead':
        await markDead(args.supabase, delivery.id, outcome.reason, outcome)
        log.warn('delivery dead', { ...logCtx, reason: outcome.reason, responseStatus: outcome.responseStatus })
        summary.dead++
        if (outcome.disableWebhook) {
          await disableWebhook(args.supabase, webhook.id, outcome.reason)
          log.warn('webhook auto-disabled', { ...logCtx, reason: outcome.reason })
        }
        break
      case 'failed':
        if (delivery.attempts + 1 >= MAX_ATTEMPTS) {
          await markDead(args.supabase, delivery.id, 'attempts_exhausted', outcome)
          log.warn('delivery dead — attempts exhausted', { ...logCtx, lastError: outcome.error })
          summary.dead++
        } else {
          await markFailedForRetry(args.supabase, delivery.id, delivery.attempts, outcome, now)
          log.info('delivery failed — retry scheduled', { ...logCtx, error: outcome.error, responseStatus: outcome.responseStatus })
          summary.failed++
        }
        break
    }
  }

  return summary
}

// ──────────────────────────────────────────────────────────────────────
// DB ops
// ──────────────────────────────────────────────────────────────────────

/**
 * Mark in_flight rows whose updated_at is older than the stuck-threshold
 * back to 'failed' with next_attempt_at = now so they re-enter the
 * dispatch queue. Best-effort — a write failure here is logged but
 * doesn't block the rest of the cycle.
 */
async function recoverStuckInFlight(supabase: SupabaseClient, now: Date): Promise<void> {
  const stuckBefore = new Date(now.getTime() - 2 * REQUEST_TIMEOUT_MS)
  // The status='in_flight' filter alone is not sufficient — a row could
  // race between this SELECT and the UPDATE and reach 'delivered' or
  // 'dead' in the interim. Postgres applies the status filter to the
  // CURRENT (post-race) state, so the row would slip through and the
  // immutability trigger would raise check_violation, aborting the
  // entire bulk UPDATE and leaving legitimately stuck rows unrecovered.
  //
  // Defense-in-depth: explicitly exclude terminal status values. The
  // partial guard makes a successful sweep on a mixed batch safe even
  // when one row terminalized mid-flight.
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .update({
      status: 'failed',
      next_attempt_at: now.toISOString(),
      error: 'recovered_from_in_flight_timeout',
    })
    .eq('status', 'in_flight')
    .not('status', 'in', '(delivered,dead)')
    .lt('updated_at', stuckBefore.toISOString())
    .select('id')

  if (error) {
    log.warn('stuck in_flight recovery failed', { code: error.code })
    return
  }
  if (data && data.length > 0) {
    log.warn('recovered stuck in_flight rows', { count: data.length })
  }
}

async function claimDueDeliveries(
  supabase: SupabaseClient,
  batchSize: number,
  now: Date,
): Promise<DueDelivery[]> {
  // PostgREST cannot express FOR UPDATE SKIP LOCKED through the JS client.
  // The cleaner long-term shape is a SQL claim function — tracked for a
  // follow-up commit. Until then we SELECT candidate rows, then UPDATE
  // with a CAS guard and `.select('id')` to learn which rows the UPDATE
  // actually claimed. The dispatch loop runs ONLY against the intersection
  // of (selected, claimed) — so an overlapping cron tick that picked up
  // the same SELECT can never double-deliver: at most one tick wins the
  // CAS update for any given row.
  //
  // Per-minute Vercel cron has best-effort single-instance semantics, but
  // the documented contract is "at-least-once" not "at-most-once" — under
  // load (e.g. a 50-row batch with mostly slow receivers > 60s) the next
  // tick can fire while this one is still running, so the CAS-then-
  // intersect pattern is load-bearing, not defensive.
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select('id, webhook_id, company_id, event_type, payload, previous_attributes, api_version, attempts')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now.toISOString())
    // Skip dangling rows (webhook deleted between enqueue and dispatch).
    // The webhook_deliveries.webhook_id FK is ON DELETE SET NULL
    // (migration 20260515170000) so terminal rows survive webhook deletion
    // for BFNAR 2013:2 kap 8 § audit retention; non-terminal rows for a
    // deleted webhook have no receiver to deliver to and stay dormant in
    // the audit trail.
    .not('webhook_id', 'is', null)
    .order('next_attempt_at', { ascending: true })
    .limit(batchSize)

  if (error || !data) {
    log.error('claim due deliveries failed', error as Error)
    return []
  }
  if (data.length === 0) return []

  const candidates = data as DueDelivery[]
  const candidateIds = candidates.map((d) => d.id)

  const { data: claimed, error: updateErr } = await supabase
    .from('webhook_deliveries')
    .update({ status: 'in_flight' })
    .in('id', candidateIds)
    .in('status', ['pending', 'failed']) // CAS guard
    .select('id')

  if (updateErr) {
    log.error('claim deliveries update failed', updateErr as Error)
    return []
  }

  // Trust the UPDATE's returned set as authoritative — anything not in
  // `claimed` was lost to a competing tick (or had its status flipped
  // out from under us between SELECT and UPDATE).
  const claimedIds = new Set(((claimed ?? []) as { id: string }[]).map((r) => r.id))
  return candidates.filter((d) => claimedIds.has(d.id))
}

async function loadWebhooksByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, WebhookForDelivery>> {
  // Include company_id so the dispatch loop can assert that the delivery
  // row's company_id matches the webhook's — defense in depth against a
  // poisoned delivery row pointing at another tenant's webhook
  // (compromised service-role path, faulty INSERT in a future code path,
  // etc.). The DB trigger added in 20260515190000 enforces the same
  // invariant at INSERT time; this is the application-layer mirror.
  const { data, error } = await supabase
    .from('webhooks')
    .select('id, company_id, webhook_url, secret')
    .in('id', ids)

  if (error || !data) {
    log.error('webhook lookup for dispatch failed', error as Error)
    return new Map()
  }
  return new Map((data as WebhookForDelivery[]).map((w) => [w.id, w]))
}

async function markDelivered(
  supabase: SupabaseClient,
  id: string,
  outcome: DeliveredOutcome,
): Promise<void> {
  const { error } = await supabase
    .from('webhook_deliveries')
    .update({
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      attempts: outcome.attempts,
      response_status: outcome.responseStatus,
      response_body: outcome.responseBody,
      response_headers: outcome.responseHeaders,
      error: null,
    })
    .eq('id', id)
  if (error) log.warn('mark delivered update failed', { id, code: error.code })
}

async function markFailedForRetry(
  supabase: SupabaseClient,
  id: string,
  priorAttempts: number,
  outcome: FailedOutcome,
  now: Date,
): Promise<void> {
  const nextAttemptIndex = priorAttempts // 0-indexed lookup into RETRY_BACKOFF_SECONDS
  const backoffSeconds = RETRY_BACKOFF_SECONDS[Math.min(nextAttemptIndex, RETRY_BACKOFF_SECONDS.length - 1)]
  const nextAttemptAt = new Date(now.getTime() + backoffSeconds * 1000)

  const { error } = await supabase
    .from('webhook_deliveries')
    .update({
      status: 'failed',
      attempts: priorAttempts + 1,
      next_attempt_at: nextAttemptAt.toISOString(),
      response_status: outcome.responseStatus ?? null,
      response_body: outcome.responseBody ?? null,
      response_headers: outcome.responseHeaders ?? null,
      error: outcome.error,
    })
    .eq('id', id)
  if (error) log.warn('mark failed-for-retry update failed', { id, code: error.code })
}

async function markDead(
  supabase: SupabaseClient,
  id: string,
  reason: string,
  outcome?: AttemptOutcome,
): Promise<void> {
  // delivered_at means "the receiver acknowledged the event". For dead
  // rows (HTTP 410, attempts exhausted, webhook deleted, cross-tenant
  // mismatch, unsafe URL) the receiver did NOT acknowledge — leaving
  // delivered_at NULL keeps the audit semantics clean. An auditor
  // querying `WHERE delivered_at IS NOT NULL` correctly sees only
  // genuinely delivered rows. The terminal-state timestamp lives on
  // `updated_at` (auto-stamped by the table's BEFORE UPDATE trigger).
  const { error } = await supabase
    .from('webhook_deliveries')
    .update({
      status: 'dead',
      attempts: outcome && 'attempts' in outcome ? outcome.attempts : undefined,
      response_status: outcome && 'responseStatus' in outcome ? outcome.responseStatus : null,
      response_body: outcome && 'responseBody' in outcome ? outcome.responseBody : null,
      response_headers: outcome && 'responseHeaders' in outcome ? outcome.responseHeaders : null,
      error: reason,
    })
    .eq('id', id)
  if (error) log.warn('mark dead update failed', { id, code: error.code })
}

async function disableWebhook(
  supabase: SupabaseClient,
  webhookId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from('webhooks')
    .update({
      disabled_at: new Date().toISOString(),
      disabled_reason: reason,
      active: false,
    })
    .eq('id', webhookId)
  if (error) log.warn('webhook auto-disable failed', { webhookId, code: error.code })
}

// ──────────────────────────────────────────────────────────────────────
// HTTP attempt
// ──────────────────────────────────────────────────────────────────────

type DeliveredOutcome = {
  kind: 'delivered'
  attempts: number
  responseStatus: number
  responseBody: string | null
  responseHeaders: Record<string, string> | null
}

type FailedOutcome = {
  kind: 'failed'
  attempts: number
  responseStatus: number | null
  responseBody: string | null
  responseHeaders: Record<string, string> | null
  error: string
}

type DeadOutcome = {
  kind: 'dead'
  reason: string
  disableWebhook: boolean
  attempts: number
  responseStatus: number | null
  responseBody: string | null
  responseHeaders: Record<string, string> | null
  error?: string
}

type AttemptOutcome = DeliveredOutcome | FailedOutcome | DeadOutcome

async function attemptDelivery(args: {
  delivery: DueDelivery
  webhook: WebhookForDelivery
  fetchImpl: typeof fetch
  now: Date
}): Promise<AttemptOutcome> {
  const { delivery, webhook, fetchImpl, now } = args
  const attempts = delivery.attempts + 1
  const requestId = `whdel_${delivery.id}`

  const body = JSON.stringify({
    id: delivery.id,
    type: delivery.event_type,
    api_version: delivery.api_version,
    created: Math.floor(now.getTime() / 1000),
    data: { object: delivery.payload },
    previous_attributes: delivery.previous_attributes,
  })

  // Re-validate the URL at dispatch time as defense in depth — DNS records
  // can change between webhook creation and dispatch (DNS rebinding,
  // hijack, A-record swap to internal IP), so the create-time check alone
  // is insufficient. A failure here marks the delivery dead with a
  // distinct reason so the operator can investigate without thinking it's
  // a transient receiver issue.
  const urlCheck = await validateWebhookUrl(webhook.webhook_url)
  if (!urlCheck.ok) {
    return {
      kind: 'dead',
      reason: `url_unsafe:${urlCheck.reason}`,
      disableWebhook: true,
      attempts,
      responseStatus: null,
      responseBody: null,
      responseHeaders: null,
      error: urlCheck.detail,
    }
  }

  const { header } = signPayload({ body, secret: webhook.secret, timestamp: Math.floor(now.getTime() / 1000) })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetchImpl(webhook.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gnubok-Signature': header,
        'X-Gnubok-Event': delivery.event_type,
        'X-Gnubok-Delivery': delivery.id,
        'X-Gnubok-Api-Version': delivery.api_version,
        'X-Request-Id': requestId,
        'User-Agent': 'gnubok-webhook/1',
      },
      body,
      signal: controller.signal,
      // Reject 3xx responses entirely. Following a redirect would let a
      // receiver bounce the dispatcher to a private/internal address
      // AFTER the SSRF guard (which validated the original webhook_url's
      // hostname) has cleared. Receivers that legitimately move endpoints
      // should ask integrators to update the webhook URL.
      redirect: 'error',
    })
  } catch (err) {
    clearTimeout(timeout)
    const message = err instanceof Error ? err.message : String(err)

    // Distinguish redirect-rejection errors from generic transport
    // failures. With redirect: 'error' the runtime fetch throws when the
    // receiver returns 3xx — that's an SSRF-bypass attempt (or a
    // misconfigured receiver), not a transient failure. Treating it as
    // 'failed' would burn 8 retry attempts over ~72h before going dead.
    // Mirror the HTTP 410 treatment: terminal + auto-disable so the
    // operator surfaces the misbehaving receiver immediately.
    //
    // Node's undici (the runtime fetch) raises 'unexpected redirect'
    // / 'redirect mode is set to error' messages; check both shapes
    // since the exact wording has changed across Node versions.
    const isRedirectError = /redirect/i.test(message)
    if (isRedirectError) {
      return {
        kind: 'dead',
        reason: 'redirect_blocked',
        disableWebhook: true,
        attempts,
        responseStatus: null,
        responseBody: null,
        responseHeaders: null,
        error: message.length > 500 ? `${message.slice(0, 497)}...` : message,
      }
    }

    return {
      kind: 'failed',
      attempts,
      responseStatus: null,
      responseBody: null,
      responseHeaders: null,
      error: message.length > 500 ? `${message.slice(0, 497)}...` : message,
    }
  }

  // Keep the abort timeout armed across the body read — a slow body
  // stream can stall the entire dispatch batch otherwise. Clear only
  // after readBoundedText returns (or aborts).
  let responseBody: string | null
  try {
    responseBody = await readBoundedText(response)
  } finally {
    clearTimeout(timeout)
  }
  const responseHeaders = headersToObject(response.headers)

  // HTTP 410 — receiver explicitly asks us to stop. Auto-disable the
  // webhook + mark this delivery dead.
  if (response.status === 410) {
    return {
      kind: 'dead',
      reason: 'http_410_gone',
      disableWebhook: true,
      attempts,
      responseStatus: 410,
      responseBody,
      responseHeaders,
    }
  }

  if (response.status >= 200 && response.status < 300) {
    return {
      kind: 'delivered',
      attempts,
      responseStatus: response.status,
      responseBody,
      responseHeaders,
    }
  }

  return {
    kind: 'failed',
    attempts,
    responseStatus: response.status,
    responseBody,
    responseHeaders,
    error: `HTTP ${response.status}`,
  }
}

// Content-Type prefixes for which we persist response_body verbatim. Other
// types (text/html error pages, application/octet-stream, ...) get dropped
// because they routinely echo PII back from receiver-side error renderers
// (Art.32(1)(b), A.8.12). A null body is just as useful for debugging
// when the operator can see the response_status and response_headers.
const SAFE_BODY_CONTENT_TYPE_PREFIXES = ['text/plain', 'application/json']

async function readBoundedText(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const isSafe = SAFE_BODY_CONTENT_TYPE_PREFIXES.some((p) => contentType.startsWith(p))
  if (!isSafe) {
    // Drain the body so the connection can be reused, but discard the bytes.
    try { await response.text() } catch { /* ignore */ }
    return null
  }
  try {
    const text = await response.text()
    if (text.length <= MAX_RESPONSE_BODY_BYTES) return text
    return text.slice(0, MAX_RESPONSE_BODY_BYTES)
  } catch {
    return null
  }
}

// Allowlist for response_headers persistence. Receiver-side headers like
// Set-Cookie, Authorization, WWW-Authenticate, internal tracing, and
// vendor x-* headers can carry credentials or sensitive identifiers; we
// don't need them for delivery diagnostics. (CC7.2 / Art.32(1)(b))
//
// 'server' is deliberately NOT in the allowlist (A.8.12): it carries no
// diagnostic value but routinely leaks receiver infrastructure version
// strings (nginx/1.21.6, Apache/2.4.41, ...) into a multi-tenant audit
// table.
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'date',
  'x-request-id',
  'cf-ray',
])

function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.forEach((v, k) => {
    if (SAFE_RESPONSE_HEADERS.has(k.toLowerCase())) {
      obj[k] = v
    }
  })
  return obj
}

export const __TESTING__ = {
  RETRY_BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BODY_BYTES,
}
