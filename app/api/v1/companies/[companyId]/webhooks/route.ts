/**
 * /api/v1/companies/{companyId}/webhooks — list + create webhook subscriptions.
 *
 * GET   — list all webhooks for the company. Secret never exposed.
 * POST  — create. Returns the secret EXACTLY ONCE in the response. Idempotent
 *         via Idempotency-Key. Dry-runnable.
 *
 * Phase 6 PR-1 ships the substrate; subsequent commits within this PR will:
 *   - Add full registry metadata (description, useWhen, pitfalls, example).
 *   - Add integration tests under __tests__/.
 *   - Wire the OpenAPI generator's content-type for the secret-once response.
 */

import { z } from 'zod'
import { created, paginated } from '@/lib/api/v1/response'
import { dryRunPreview } from '@/lib/api/v1/dry-run'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponse, v1ErrorResponseFromCode } from '@/lib/api/v1/errors'
import { generateWebhookSecret } from '@/lib/webhooks/signing'
import { API_V1_VERSION } from '@/lib/api/v1/version'

const WEBHOOK_EVENT_TYPES = z.enum([
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

const CreateWebhookSchema = z.object({
  event_type: WEBHOOK_EVENT_TYPES,
  webhook_url: z.string().url().max(2048),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
})

const WebhookSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  event_type: z.string(),
  webhook_url: z.string(),
  active: z.boolean(),
  api_version_pinned: z.string(),
  disabled_at: z.string().nullable(),
  disabled_reason: z.string().nullable(),
  created_at: z.string(),
})

const WebhookCreated = WebhookSummary.extend({
  /** Secret returned EXACTLY ONCE on creation. Never exposed on list/detail. */
  secret: z.string(),
  description: z.string().nullable(),
})

const WebhooksListResponse = z.object({
  webhooks: z.array(WebhookSummary),
})

const WEBHOOK_LIST_COLUMNS =
  'id, name, event_type, webhook_url, active, api_version_pinned, disabled_at, disabled_reason, created_at'

// ──────────────────────────────────────────────────────────────────
// GET — list webhooks
// ──────────────────────────────────────────────────────────────────

registerEndpoint({
  operation: 'webhooks.list',
  method: 'GET',
  path: '/api/v1/companies/:companyId/webhooks',
  summary: 'List webhook subscriptions for a company.',
  description:
    'Returns all webhook subscriptions for the company. The HMAC signing secret is never exposed by this endpoint — it is returned exactly once when the webhook is created.',
  useWhen:
    'You need to enumerate the webhook subscriptions an integration has registered, e.g. to build a UI listing or sync state with an external system.',
  doNotUseFor:
    'Reading delivery history (use GET /webhooks/{id}/deliveries). Reading the secret (it is unrecoverable after the create response — generate a new webhook if lost).',
  pitfalls: [
    'Disabled webhooks (auto-disabled after HTTP 410, or manually disabled via PATCH) appear in the list with active=false and a disabled_reason.',
  ],
  example: {
    response: {
      data: {
        webhooks: [
          {
            id: 'a8f1…',
            name: 'CRM sync',
            event_type: 'invoice.paid',
            webhook_url: 'https://example.com/hooks/gnubok',
            active: true,
            api_version_pinned: API_V1_VERSION,
            disabled_at: null,
            disabled_reason: null,
            created_at: '2026-05-15T12:00:00Z',
          },
        ],
      },
      meta: { request_id: 'req_…', api_version: API_V1_VERSION },
    },
  },
  scope: 'webhooks:manage',
  risk: 'low',
  idempotent: true,
  reversible: false,
  dryRunSupported: false,
  response: { success: WebhooksListResponse },
})

export const GET = withApiV1<{ params: Promise<{ companyId: string }> }>(
  'webhooks.list',
  async (_request, ctx) => {
    const { data, error } = await ctx.supabase
      .from('webhooks')
      .select(WEBHOOK_LIST_COLUMNS)
      .eq('company_id', ctx.companyId!)
      .order('created_at', { ascending: false })

    if (error) {
      return v1ErrorResponse(error, ctx.log, { requestId: ctx.requestId })
    }

    return paginated(data ?? [], { requestId: ctx.requestId })
  },
)

// ──────────────────────────────────────────────────────────────────
// POST — create webhook
// ──────────────────────────────────────────────────────────────────

registerEndpoint({
  operation: 'webhooks.create',
  method: 'POST',
  path: '/api/v1/companies/:companyId/webhooks',
  summary: 'Register a webhook subscription.',
  description:
    'Creates a webhook subscription for one event type. The response includes a freshly generated HMAC signing secret, returned EXACTLY ONCE — store it on the receiver side immediately. The webhook is pinned to the current API version on creation; payload shapes for this webhook will not change until you explicitly upgrade.',
  useWhen:
    'You are wiring a downstream integration that needs push notifications instead of polling.',
  doNotUseFor:
    'Subscribing to internal MCP telemetry events (mcp.tool_called etc. are not delivered as webhooks). Replacing an existing webhook URL — use PATCH instead.',
  pitfalls: [
    'The secret is returned exactly once. If lost, delete and recreate the webhook.',
    'Delivery is at-least-once with exponential backoff (1m / 5m / 30m / 2h / 12h / 24h / 48h). Receivers MUST be idempotent.',
    'HTTP 410 from your receiver auto-disables the webhook (sets active=false + disabled_reason).',
  ],
  example: {
    request: {
      event_type: 'invoice.paid',
      webhook_url: 'https://example.com/hooks/gnubok',
      name: 'CRM sync',
    },
    response: {
      data: {
        id: 'a8f1…',
        name: 'CRM sync',
        event_type: 'invoice.paid',
        webhook_url: 'https://example.com/hooks/gnubok',
        active: true,
        api_version_pinned: API_V1_VERSION,
        disabled_at: null,
        disabled_reason: null,
        secret: 'whsec_…',
        description: null,
        created_at: '2026-05-15T12:00:00Z',
      },
      meta: { request_id: 'req_…', api_version: API_V1_VERSION },
    },
  },
  scope: 'webhooks:manage',
  risk: 'low',
  idempotent: true,
  reversible: true,
  dryRunSupported: true,
  request: { body: CreateWebhookSchema },
  response: { success: WebhookCreated },
})

export const POST = withApiV1<{ params: Promise<{ companyId: string }> }>(
  'webhooks.create',
  async (request, ctx) => {
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'body', message: 'Body is not valid JSON.' },
      })
    }

    const parsed = CreateWebhookSchema.safeParse(rawBody)
    if (!parsed.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: {
          issues: parsed.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
      })
    }
    const body = parsed.data

    if (ctx.dryRun) {
      return dryRunPreview(
        {
          id: null,
          name: body.name,
          event_type: body.event_type,
          webhook_url: body.webhook_url,
          active: true,
          api_version_pinned: API_V1_VERSION,
          disabled_at: null,
          disabled_reason: null,
          // Never generate or echo a secret on dry-run.
          secret: null,
          description: body.description ?? null,
          created_at: null,
        },
        { requestId: ctx.requestId, log: ctx.log },
      )
    }

    const secret = `whsec_${generateWebhookSecret()}`

    const { data, error } = await ctx.supabase
      .from('webhooks')
      .insert({
        user_id: ctx.userId,
        company_id: ctx.companyId!,
        name: body.name,
        description: body.description ?? null,
        event_type: body.event_type,
        webhook_url: body.webhook_url,
        secret,
        api_version_pinned: API_V1_VERSION,
        created_by_api_key_id: ctx.apiKeyId ?? null,
        active: true,
      })
      .select(`${WEBHOOK_LIST_COLUMNS}, description`)
      .single()

    if (error) {
      return v1ErrorResponse(error, ctx.log, { requestId: ctx.requestId })
    }

    // Secret returned exactly once. Caller must persist it on the receiver
    // side — gnubok will not surface it on any subsequent endpoint.
    return created({ ...(data as Record<string, unknown>), secret }, { requestId: ctx.requestId })
  },
  { requireIdempotencyKey: true },
)
