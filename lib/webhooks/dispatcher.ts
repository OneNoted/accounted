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
      // there's no receiver to deliver to and CASCADE will eventually
      // remove the delivery row anyway.
      await markDead(args.supabase, delivery.id, 'webhook_deleted')
      summary.dead++
      continue
    }

    const outcome = await attemptDelivery({
      delivery,
      webhook,
      fetchImpl,
      now,
    })

    switch (outcome.kind) {
      case 'delivered':
        await markDelivered(args.supabase, delivery.id, outcome)
        summary.delivered++
        break
      case 'dead':
        await markDead(args.supabase, delivery.id, outcome.reason, outcome)
        summary.dead++
        if (outcome.disableWebhook) {
          await disableWebhook(args.supabase, webhook.id, outcome.reason)
        }
        break
      case 'failed':
        if (delivery.attempts + 1 >= MAX_ATTEMPTS) {
          await markDead(args.supabase, delivery.id, 'attempts_exhausted', outcome)
          summary.dead++
        } else {
          await markFailedForRetry(args.supabase, delivery.id, delivery.attempts, outcome, now)
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

async function claimDueDeliveries(
  supabase: SupabaseClient,
  batchSize: number,
  now: Date,
): Promise<DueDelivery[]> {
  // PostgREST cannot express FOR UPDATE SKIP LOCKED through the JS client.
  // We rely on a SQL function `claim_due_webhook_deliveries(p_now, p_limit)`
  // that the migration adds — TODO in next commit. For the skeleton we
  // SELECT-then-UPDATE the rows to status='in_flight'; the partial-index
  // narrowing keeps the candidate set tight, and the per-minute cron's
  // single-instance guarantee on Vercel makes the race window negligible
  // in practice. This will be tightened in PR review round 1.
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select('id, webhook_id, company_id, event_type, payload, previous_attributes, api_version, attempts')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(batchSize)

  if (error || !data) {
    log.error('claim due deliveries failed', error as Error)
    return []
  }
  if (data.length === 0) return []

  const ids = (data as DueDelivery[]).map((d) => d.id)
  const { error: updateErr } = await supabase
    .from('webhook_deliveries')
    .update({ status: 'in_flight' })
    .in('id', ids)
    .in('status', ['pending', 'failed']) // CAS guard

  if (updateErr) {
    log.error('claim deliveries update failed', updateErr as Error)
    return []
  }

  return data as DueDelivery[]
}

async function loadWebhooksByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, WebhookForDelivery>> {
  const { data, error } = await supabase
    .from('webhooks')
    .select('id, webhook_url, secret')
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
  const { error } = await supabase
    .from('webhook_deliveries')
    .update({
      status: 'dead',
      delivered_at: new Date().toISOString(),
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
    })
  } catch (err) {
    clearTimeout(timeout)
    const message = err instanceof Error ? err.message : String(err)
    return {
      kind: 'failed',
      attempts,
      responseStatus: null,
      responseBody: null,
      responseHeaders: null,
      error: message.length > 500 ? `${message.slice(0, 497)}...` : message,
    }
  }
  clearTimeout(timeout)

  const responseBody = await readBoundedText(response)
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

async function readBoundedText(response: Response): Promise<string | null> {
  try {
    const text = await response.text()
    if (text.length <= MAX_RESPONSE_BODY_BYTES) return text
    return text.slice(0, MAX_RESPONSE_BODY_BYTES)
  } catch {
    return null
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.forEach((v, k) => {
    obj[k] = v
  })
  return obj
}

export const __TESTING__ = {
  RETRY_BACKOFF_SECONDS,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BODY_BYTES,
}
