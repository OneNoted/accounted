import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'
import { ensureInitialized } from '@/lib/init'
import { reverseEntry, createDraftEntry } from '@/lib/bookkeeping/engine'
import { getErrorMessage } from '@/lib/errors/get-error-message'
import { createLogger } from '@/lib/logger'
import type { CreateJournalEntryLineInput, JournalEntryLine } from '@/types'

const logger = createLogger('journal-entries.edit-recreate')

ensureInitialized()

/**
 * POST /api/bookkeeping/journal-entries/[id]/edit-recreate
 *
 * Edit-as-correction flow for the latest voucher in a series. Mirrors the
 * way Fortnox / Visma / Bokio handle "edit voucher" under the hood:
 *   1. Storno the existing posted entry (preserves BFL audit trail).
 *   2. Create a fresh draft pre-populated with the original lines.
 *   3. Return the draft id so the UI can redirect the user to the editor.
 *
 * Eligibility gate is identical to delete-last-voucher: caller must be
 * owner/admin, the entry must be the last in its series within the period,
 * and the period must not be closed/locked. We don't enforce those gates
 * here directly — reverseEntry will raise when the period is locked, and
 * the chain endpoint already drives the UI gate via is_last_in_series.
 * The first failure surfaces through getErrorMessage with a Swedish copy.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  // Fetch original entry with lines
  const { data: original, error: fetchError } = await supabase
    .from('journal_entries')
    .select('*, lines:journal_entry_lines(*)')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (fetchError || !original) {
    return NextResponse.json({ error: 'Verifikatet hittades inte' }, { status: 404 })
  }

  if (original.status !== 'posted') {
    return NextResponse.json(
      { error: 'Endast bokförda verifikat kan redigeras med makulerings-flödet' },
      { status: 400 },
    )
  }

  // Last-in-series check: matches the chain endpoint's logic so the API
  // surface is honest even when called directly.
  const { data: maxRow } = await supabase
    .from('journal_entries')
    .select('voucher_number')
    .eq('company_id', companyId)
    .eq('fiscal_period_id', original.fiscal_period_id)
    .eq('voucher_series', original.voucher_series)
    .not('status', 'in', '(cancelled,draft)')
    .order('voucher_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!maxRow || maxRow.voucher_number !== original.voucher_number) {
    return NextResponse.json(
      { error: 'Endast det sista verifikatet i serien kan redigeras' },
      { status: 400 },
    )
  }

  try {
    // 1. Storno the original (audit trail intact; reverseEntry handles the
    //    period-lock check and voucher numbering).
    await reverseEntry(supabase, companyId, user.id, id)

    // 2. Build a draft mirroring the original's lines and metadata.
    const lines = (original.lines as JournalEntryLine[]) || []
    const draftLines: CreateJournalEntryLineInput[] = lines.map((line) => ({
      account_number: line.account_number,
      debit_amount: Number(line.debit_amount) || 0,
      credit_amount: Number(line.credit_amount) || 0,
      line_description: line.line_description ?? undefined,
      currency: line.currency ?? undefined,
      amount_in_currency: line.amount_in_currency ?? undefined,
      exchange_rate: line.exchange_rate ?? undefined,
      tax_code: line.tax_code ?? undefined,
      cost_center: line.cost_center ?? undefined,
      project: line.project ?? undefined,
    }))

    const draft = await createDraftEntry(supabase, companyId, user.id, {
      fiscal_period_id: original.fiscal_period_id,
      entry_date: original.entry_date,
      description: original.description,
      source_type: 'manual',
      voucher_series: original.voucher_series || 'A',
      lines: draftLines,
    })

    return NextResponse.json({ data: { draftId: draft.id } })
  } catch (err) {
    logger.error('edit-recreate failed', { entryId: id, error: err })
    return NextResponse.json(
      { error: getErrorMessage(err, { context: 'journal_entry', statusCode: 400 }) },
      { status: 400 },
    )
  }
}
