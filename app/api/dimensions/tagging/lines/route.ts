/**
 * GET /api/dimensions/tagging/lines — posted VOUCHERS (with their complete
 * line sets) for the bulk retro-tagging workbench (dimensions plan PR6 §3,
 * voucher-level rework).
 *
 * The verifikat is the unit of work: filters select qualifying vouchers
 * (period, entry-date range, free text, "has a line in the account range",
 * "has an untagged line") and the response carries every line of each
 * qualifying voucher so tagging a voucher means tagging a complete verifikat
 * — never the filtered subset of one.
 *
 * Reversal pairs are EXCLUDED by default: an annulled entry and its storno
 * net to zero in every dimension bucket as long as both sides carry the same
 * tag, so retro-tagging them is a no-op with an asymmetry foot-gun attached.
 * `include_annulled=1` opts them back in (the workbench keeps its blocking
 * motverifikat confirmation in that view only).
 *
 * Hard cap counts VOUCHERS (limit+1 fetch → `total_capped: true`); the UI
 * shows a "narrow your filter" notice.
 *
 * Response: 200 { data: { vouchers: [...], total_capped } } where each
 * voucher is { journal_entry_id, entry_date, voucher_number, voucher_series,
 * description, annulled, lines: [{ id, account_number, debit_amount,
 * credit_amount, dimensions }] }.
 */
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { withRouteContext } from '@/lib/api/with-route-context'
import { validateQuery } from '@/lib/api/validate'
import { DimensionTaggingLinesQuerySchema } from '@/lib/api/schemas'
import { errorResponse } from '@/lib/errors/get-structured-error'
import { escapeLikePattern } from '@/lib/invoices/duplicate-payment-guard'

ensureInitialized()

interface RawEntry {
  id: string
  entry_date: string
  voucher_number: number | null
  voucher_series: string | null
  description: string
  reversed_by_id: string | null
  reverses_id: string | null
  fiscal_period_id: string
}

interface RawLine {
  id: string
  account_number: string
  debit_amount: number
  credit_amount: number
  dimensions: Record<string, string> | null
  journal_entry_id: string
  sort_order: number | null
}

export const GET = withRouteContext(
  'dimensions.tagging.lines',
  async (request, ctx) => {
    const { supabase, companyId, log, requestId } = ctx

    const validation = validateQuery(request, DimensionTaggingLinesQuerySchema, {
      log,
      operation: 'dimensions.tagging.lines',
    })
    if (!validation.success) return validation.response
    const q = validation.data

    // Step 1: qualifying vouchers. Line-level filters (account range, only
    // untagged) become "voucher HAS such a line" via the inner join — the
    // parent row appears once regardless of how many lines match.
    let entryQuery = supabase
      .from('journal_entries')
      .select(
        'id, entry_date, voucher_number, voucher_series, description, reversed_by_id, reverses_id, fiscal_period_id, journal_entry_lines!inner(id)',
      )
      .eq('company_id', companyId)
      // Posted only — drafts are edited directly in the voucher editor and the
      // retag RPC rejects them anyway.
      .eq('status', 'posted')

    if (q.include_annulled !== '1') {
      // Default view: no reversal pairs. Both sides net to zero in every
      // dimension bucket when kept together, so they are pure noise here —
      // and hiding them makes tagging one side without the other impossible.
      entryQuery = entryQuery.is('reversed_by_id', null).is('reverses_id', null)
    }

    if (q.period_id) entryQuery = entryQuery.eq('fiscal_period_id', q.period_id)
    if (q.date_from) entryQuery = entryQuery.gte('entry_date', q.date_from)
    if (q.date_to) entryQuery = entryQuery.lte('entry_date', q.date_to)
    if (q.text) {
      // Escape LIKE wildcards (\ % _) so they match literally — same posture
      // as the journal-entries list route.
      entryQuery = entryQuery.ilike('description', `%${escapeLikePattern(q.text)}%`)
    }
    if (q.account_from) {
      entryQuery = entryQuery.gte('journal_entry_lines.account_number', q.account_from)
    }
    if (q.account_to) {
      entryQuery = entryQuery.lte('journal_entry_lines.account_number', q.account_to)
    }
    if (q.only_untagged === '1') {
      // dimensions is NOT NULL DEFAULT '{}' (substrate migration), so the
      // empty-map equality is the complete "untagged" predicate. Combined
      // with an account range this reads "has an untagged line in the range".
      entryQuery = entryQuery.eq('journal_entry_lines.dimensions', '{}')
    }

    const { data: entryData, error: entryError } = await entryQuery
      .order('entry_date', { ascending: true })
      .order('voucher_series', { ascending: true })
      .order('voucher_number', { ascending: true })
      .order('id', { ascending: true })
      .limit(q.limit + 1)

    if (entryError) {
      log.error('tagging voucher browse failed', entryError)
      return errorResponse(entryError, log, { requestId })
    }

    const rawEntries = (entryData ?? []) as unknown as RawEntry[]
    const totalCapped = rawEntries.length > q.limit
    const entries = totalCapped ? rawEntries.slice(0, q.limit) : rawEntries

    if (entries.length === 0) {
      return NextResponse.json({ data: { vouchers: [], total_capped: totalCapped } })
    }

    // Step 2: the COMPLETE line set for each qualifying voucher, so voucher-
    // level tagging always covers the whole verifikat.
    const { data: lineData, error: lineError } = await supabase
      .from('journal_entry_lines')
      .select('id, account_number, debit_amount, credit_amount, dimensions, journal_entry_id, sort_order')
      .in('journal_entry_id', entries.map((e) => e.id))
      .order('journal_entry_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })

    if (lineError) {
      log.error('tagging voucher line fetch failed', lineError)
      return errorResponse(lineError, log, { requestId })
    }

    const linesByEntry = new Map<string, RawLine[]>()
    for (const line of (lineData ?? []) as unknown as RawLine[]) {
      const bucket = linesByEntry.get(line.journal_entry_id) ?? []
      bucket.push(line)
      linesByEntry.set(line.journal_entry_id, bucket)
    }

    const vouchers = entries.map((e) => ({
      journal_entry_id: e.id,
      entry_date: e.entry_date,
      voucher_number: e.voucher_number,
      voucher_series: e.voucher_series,
      description: e.description,
      annulled: Boolean(e.reversed_by_id || e.reverses_id),
      reversed_by_id: e.reversed_by_id,
      reverses_id: e.reverses_id,
      fiscal_period_id: e.fiscal_period_id,
      lines: (linesByEntry.get(e.id) ?? []).map((l) => ({
        id: l.id,
        account_number: l.account_number,
        debit_amount: l.debit_amount,
        credit_amount: l.credit_amount,
        dimensions: l.dimensions ?? {},
      })),
    }))

    return NextResponse.json({ data: { vouchers, total_capped: totalCapped } })
  },
)
