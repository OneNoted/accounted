/**
 * GET /api/v1/companies/{companyId}/transactions
 *
 * Cursor-paginated transaction list. Filters: status (booked/unbooked),
 * date range, currency, search (description ilike). Default sort:
 * (date DESC, id ASC) — newest first, deterministic tie-break.
 */
import { z } from 'zod'
import { paginated } from '@/lib/api/v1/response'
import {
  decodeDefaultCursor,
  encodeDefaultCursor,
  parsePaginationParams,
} from '@/lib/api/v1/pagination'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponse, v1ErrorResponseFromCode } from '@/lib/api/v1/errors'

const TransactionSummary = z.object({
  id: z.string().uuid(),
  date: z.string(),
  description: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  reference: z.string().nullable(),
  merchant_name: z.string().nullable(),
  journal_entry_id: z.string().uuid().nullable(),
  invoice_id: z.string().uuid().nullable(),
  supplier_invoice_id: z.string().uuid().nullable(),
  is_business: z.boolean().nullable(),
  category: z.string().nullable(),
  import_source: z.string().nullable(),
  created_at: z.string(),
})

const TransactionListResponse = z.object({
  transactions: z.array(TransactionSummary),
})

// Explicit projection — no SELECT *. Any new column added to transactions
// stays internal until consciously surfaced here.
const TRANSACTION_SUMMARY_COLUMNS =
  'id, date, description, amount, currency, reference, merchant_name, ' +
  'journal_entry_id, invoice_id, supplier_invoice_id, is_business, category, ' +
  'import_source, created_at'

registerEndpoint({
  operation: 'transactions.list',
  method: 'GET',
  path: '/api/v1/companies/:companyId/transactions',
  summary: 'List transactions for a company.',
  description:
    'Cursor-paginated transaction list ordered by date DESC, id ASC. Filter by ?status=booked|unbooked, ?currency, ?date_from / ?date_to, ?search (description ilike).',
  useWhen:
    'You need to walk a company\'s bank ledger — building a categorization queue, reconciling against external statements, or sampling for audit.',
  doNotUseFor:
    'Looking up one transaction by id (use the detail endpoint). Reconciliation status (use /reconciliation/bank/status).',
  pitfalls: [
    'Default page size is 50. Pass ?limit=100 for the maximum. Cursor pagination — pass ?cursor=<next_cursor> from the previous response.',
    'A booked transaction has a non-null journal_entry_id. is_business / category live on the transaction row even before booking.',
    'reverse-charge or storno entries can leave a transaction with journal_entry_id pointing at a cancelled JE — check status on the JE separately.',
  ],
  example: {
    response: {
      data: [
        {
          id: 'a8f1…',
          date: '2026-05-12',
          description: 'ICA MAXI',
          amount: -349.5,
          currency: 'SEK',
          merchant_name: 'ICA MAXI',
          journal_entry_id: null,
          is_business: null,
          category: null,
        },
      ],
      meta: { request_id: 'req_…', api_version: '2026-05-12', next_cursor: null },
    },
  },
  scope: 'transactions:read',
  risk: 'low',
  idempotent: true,
  reversible: false,
  dryRunSupported: false,
  response: { success: TransactionListResponse },
})

export const GET = withApiV1<{ params: Promise<{ companyId: string }> }>(
  'transactions.list',
  async (request, ctx) => {
    const url = new URL(request.url)
    const { limit, cursor } = parsePaginationParams(url)
    const decoded = decodeDefaultCursor(cursor)

    const FiltersSchema = z.object({
      status: z.enum(['booked', 'unbooked']).optional(),
      currency: z.string().min(1).max(8).optional(),
      date_from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      date_to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      search: z.string().min(1).max(200).optional(),
    })
    const filtersResult = FiltersSchema.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      currency: url.searchParams.get('currency') ?? undefined,
      date_from: url.searchParams.get('date_from') ?? undefined,
      date_to: url.searchParams.get('date_to') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    })
    if (!filtersResult.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: {
          issues: filtersResult.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
        },
      })
    }
    const f = filtersResult.data

    let query = ctx.supabase
      .from('transactions')
      .select(TRANSACTION_SUMMARY_COLUMNS)
      .eq('company_id', ctx.companyId!)
      .order('date', { ascending: false })
      .order('id', { ascending: true })
      .limit(limit + 1)

    if (f.status === 'booked') query = query.not('journal_entry_id', 'is', null)
    else if (f.status === 'unbooked') query = query.is('journal_entry_id', null)
    if (f.currency) query = query.eq('currency', f.currency)
    if (f.date_from) query = query.gte('date', f.date_from)
    if (f.date_to) query = query.lte('date', f.date_to)
    if (f.search) {
      // Two-step escape (PostgREST .or delimiters, then LIKE wildcards). Same
      // pattern as customers list.
      const term = f.search.replace(/[,()]/g, '').replace(/[%_\\]/g, '\\$&')
      query = query.or(`description.ilike.%${term}%,merchant_name.ilike.%${term}%`)
    }

    if (decoded) {
      // Cursor is on (date DESC, id ASC). Date moves backward; id breaks ties.
      query = query.or(
        `date.lt.${decoded.ts},and(date.eq.${decoded.ts},id.gt.${decoded.id})`,
      )
    }

    const { data, error } = await query
    if (error) {
      return v1ErrorResponse(error, ctx.log, { requestId: ctx.requestId })
    }

    type Row = { id: string; date: string } & Record<string, unknown>
    const rows = (data ?? []) as unknown as Row[]
    const trimmed = rows.slice(0, limit)
    const hasMore = rows.length > limit
    const last = trimmed[trimmed.length - 1]
    const nextCursor =
      hasMore && last ? encodeDefaultCursor({ id: last.id, created_at: last.date }) : null

    return paginated(trimmed, {
      requestId: ctx.requestId,
      nextCursor: nextCursor ?? undefined,
    })
  },
)
