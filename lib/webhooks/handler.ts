/**
 * Webhook event-bus handler.
 *
 * Subscribes to every CoreEventType the v1 API surface emits and converts
 * each emission into N rows in `webhook_deliveries` — one per active webhook
 * subscribed to (company_id, event_type). The dispatcher cron picks them
 * up at next-minute boundary and POSTs to the receiver.
 *
 * Wired from lib/init.ts via registerWebhookHandler() so every API route
 * that calls ensureInitialized() gets the subscription wired exactly once.
 *
 * Design notes:
 *   - We do NOT block the emitting route on delivery insert: the handler
 *     runs inside Promise.allSettled in the bus (see lib/events/bus.ts), so
 *     a DB insert failure is logged but doesn't crash the emitter.
 *   - We capture `previous_attributes` only for events whose payload carries
 *     both a prior and current shape. Phase 6 PR-1 emits null for everything
 *     — adding the diff is a follow-up that requires touching each route's
 *     emit() call site to capture the prior row.
 *   - Service-role client because this code runs from the bus, outside any
 *     authenticated Supabase context.
 */

import { eventBus } from '@/lib/events/bus'
import type { CoreEventType } from '@/lib/events/types'
import { createServiceClientNoCookies } from '@/lib/auth/api-keys'
import { createLogger } from '@/lib/logger'
import { API_V1_VERSION } from '@/lib/api/v1/version'

const log = createLogger('webhooks/handler')

/**
 * Set of event types that the v1 webhook surface delivers. Restricted to the
 * resource-state-change events that are useful to external integrations;
 * MCP telemetry events and internal-only flows (event_log writes, etc.) are
 * deliberately excluded.
 *
 * Adding a new event type to this set is a public-API change — bump
 * API_V1_VERSION + add to the changelog when you do.
 */
const PUBLIC_WEBHOOK_EVENTS = new Set<CoreEventType>([
  'invoice.created',
  'invoice.sent',
  'invoice.paid',
  'credit_note.created',
  'customer.created',
  'supplier.created',
  'supplier_invoice.registered',
  'supplier_invoice.approved',
  'supplier_invoice.paid',
  'supplier_invoice.credited',
  'supplier_invoice.uncredited',
  'transaction.categorized',
  'transaction.reconciled',
  'journal_entry.committed',
  'journal_entry.reversed',
  'journal_entry.corrected',
  'period.locked',
  'period.unlocked',
  'period.year_closed',
  'salary_run.created',
  'salary_run.approved',
  'salary_run.booked',
  'agi.generated',
  'document.uploaded',
])

let registered = false

/**
 * Subscribe the webhook handler to every event in PUBLIC_WEBHOOK_EVENTS.
 * Idempotent — safe to call from ensureInitialized() across hot reloads.
 */
export function registerWebhookHandler(): void {
  if (registered) return
  registered = true

  for (const eventType of PUBLIC_WEBHOOK_EVENTS) {
    eventBus.on(eventType, async (payload) => {
      // payload type depends on eventType but every variant carries
      // companyId — the only field we structurally need here.
      const companyId = (payload as { companyId?: string }).companyId
      if (!companyId) {
        log.warn('event missing companyId — skipping webhook fanout', { eventType })
        return
      }

      try {
        await fanOutToWebhooks({
          eventType,
          companyId,
          payload: payload as Record<string, unknown>,
        })
      } catch (err) {
        log.error('webhook fanout failed', err as Error, { eventType, companyId })
      }
    })
  }

  log.info('webhook handler registered', { eventCount: PUBLIC_WEBHOOK_EVENTS.size })
}

/**
 * Look up active webhooks for (companyId, eventType) and insert one
 * webhook_deliveries row per match. Pending rows are picked up by the
 * dispatcher cron at next-minute boundary.
 */
async function fanOutToWebhooks(args: {
  eventType: string
  companyId: string
  payload: Record<string, unknown>
}): Promise<void> {
  const supabase = createServiceClientNoCookies()

  const { data: webhooks, error: fetchErr } = await supabase
    .from('webhooks')
    .select('id, secret, api_version_pinned')
    .eq('company_id', args.companyId)
    .eq('event_type', args.eventType)
    .eq('active', true)
    .is('disabled_at', null)

  if (fetchErr) {
    log.error('webhook lookup failed', fetchErr as Error, {
      companyId: args.companyId,
      eventType: args.eventType,
    })
    return
  }
  if (!webhooks || webhooks.length === 0) return

  const rows = webhooks.map((w) => ({
    webhook_id: (w as { id: string }).id,
    company_id: args.companyId,
    event_type: args.eventType,
    payload: args.payload,
    api_version: (w as { api_version_pinned: string }).api_version_pinned ?? API_V1_VERSION,
    // previous_attributes is null in Phase 6 PR-1; populated in a follow-up
    // when each route's emit() call captures the prior row.
    previous_attributes: null,
  }))

  const { error: insertErr } = await supabase.from('webhook_deliveries').insert(rows)
  if (insertErr) {
    log.error('webhook_deliveries insert failed', insertErr as Error, {
      companyId: args.companyId,
      eventType: args.eventType,
      webhookCount: rows.length,
    })
  }
}
