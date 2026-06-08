import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { validateBody } from '@/lib/api/validate'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { markEntriesNoDocRequired } from '@/lib/bookkeeping/no-doc-required'
import { NEEDS_DOC_SOURCE_TYPES } from '@/lib/worklist/categories'
import { escapeLikePattern } from '@/lib/invoices/duplicate-payment-guard'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const BulkMissingSchema = z.object({
  period_id: z.string().uuid().nullable().optional(),
  series: z.string().nullable().optional(),
  date_from: z.string().nullable().optional(),
  date_to: z.string().nullable().optional(),
  search: z.string().max(200).nullable().optional(),
  reason: z.string().trim().max(200).nullable().optional(),
  // When true, only count the matching verifikat (no writes) so the UI can
  // confirm the scope before the user commits.
  dry_run: z.boolean().optional(),
})

/**
 * Mark every posted, document-requiring verifikat that currently lacks an
 * underlag AND matches the active list filters (period / series / date / search)
 * as "Inget underlag krävs" — across all pages, in one action. This is the
 * scalable remedy for the "thousands of saknade underlag after a migration"
 * problem; the per-entry batch route handles selective marking.
 *
 * The missing-doc predicate mirrors countVerifikatMissingDocument: posted +
 * NEEDS_DOC source type, no current-version document_attachment, not already
 * exempt.
 */
export const POST = withRouteContext(
  'journal_entry.bulk_missing_no_document_required',
  async (request, { supabase, companyId, user }) => {
    const validation = await validateBody(request, BulkMissingSchema)
    if (!validation.success) return validation.response

    const { period_id, reason, dry_run } = validation.data
    const series = validation.data.series && /^[A-Z]$/.test(validation.data.series)
      ? validation.data.series
      : null
    const dateFrom = validation.data.date_from && ISO_DATE.test(validation.data.date_from)
      ? validation.data.date_from
      : null
    const dateTo = validation.data.date_to && ISO_DATE.test(validation.data.date_to)
      ? validation.data.date_to
      : null
    const search = validation.data.search?.trim() || null

    // Candidate entries: posted, document-requiring, matching the active filters.
    const candidates = await fetchAllRows<{ id: string }>(({ from, to }) => {
      let q = supabase
        .from('journal_entries')
        .select('id')
        .eq('company_id', companyId)
        .eq('status', 'posted')
        .in('source_type', [...NEEDS_DOC_SOURCE_TYPES])
      if (period_id) q = q.eq('fiscal_period_id', period_id)
      if (series) q = q.eq('voucher_series', series)
      if (dateFrom) q = q.gte('entry_date', dateFrom)
      if (dateTo) q = q.lte('entry_date', dateTo)
      if (search) q = q.ilike('description', `%${escapeLikePattern(search)}%`)
      return q.order('id').range(from, to)
    })

    if (candidates.length === 0) {
      return NextResponse.json({ data: dry_run ? { count: 0 } : { exempted: 0 } })
    }

    const [docs, exemptions] = await Promise.all([
      fetchAllRows<{ journal_entry_id: string }>(({ from, to }) =>
        supabase
          .from('document_attachments')
          .select('journal_entry_id')
          .eq('company_id', companyId)
          .eq('is_current_version', true)
          .not('journal_entry_id', 'is', null)
          .order('id')
          .range(from, to),
      ),
      fetchAllRows<{ journal_entry_id: string }>(({ from, to }) =>
        supabase
          .from('journal_entry_no_doc_required')
          .select('journal_entry_id')
          .eq('company_id', companyId)
          .order('journal_entry_id')
          .range(from, to),
      ),
    ])

    const withDoc = new Set(docs.map((d) => d.journal_entry_id))
    const exempt = new Set(exemptions.map((e) => e.journal_entry_id))
    const missingIds = candidates
      .map((e) => e.id)
      .filter((id) => !withDoc.has(id) && !exempt.has(id))

    if (dry_run) {
      return NextResponse.json({ data: { count: missingIds.length } })
    }

    if (missingIds.length === 0) {
      return NextResponse.json({ data: { exempted: 0 } })
    }

    const exempted = await markEntriesNoDocRequired(
      supabase,
      companyId,
      user.id,
      missingIds,
      reason ?? null,
    )

    return NextResponse.json({ data: { exempted } })
  },
  { requireWrite: true },
)
