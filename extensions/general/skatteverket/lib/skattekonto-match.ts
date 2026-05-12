import type { SupabaseClient } from '@supabase/supabase-js'
import type { StoredSkattekontoTransaction } from '../types'

/**
 * "Matcha mot befintligt verifikat"-flöde för skattekonto-rader.
 *
 * Jacob's use case:
 *   16/3: User books a manual transfer (D 1630 / C 1930, X kr) when they
 *         pay preliminärskatt from the bank.
 *   17/3: Skatteverket reports the same payment landing on skattekontot.
 *
 * Without matching, the per-row Bokför button would create a *second*
 * verifikat with the same 1630-leg → double-counted cash flow. This module
 * finds the existing entry and links the SKV row to it, no new draft.
 *
 * The candidate query is intentionally strict (exact amount, exact side,
 * unused entry) — false positives would be silently destructive. False
 * negatives just fall back to "Bokför / Skapa manuellt".
 */

const SKATTEKONTO_ACCOUNT = '1630'
const DATE_WINDOW_DAYS = 14

export class SkattekontoMatchError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'TRANSACTION_NOT_FOUND'
      | 'ALREADY_BOOKED'
      | 'ENTRY_NOT_FOUND'
      | 'ENTRY_ALREADY_LINKED'
      | 'INVALID_CANDIDATE',
  ) {
    super(message)
    this.name = 'SkattekontoMatchError'
  }
}

export interface SkattekontoMatchCandidate {
  journal_entry_id: string
  voucher_number: number | null
  voucher_series: string | null
  entry_date: string
  description: string
  status: 'draft' | 'posted' | 'reversed'
  matched_amount: number
  matched_side: 'debit' | 'credit'
}

/**
 * Bulk-enrich a list of unmatched SKV rows with a `match_suggestion` field
 * pointing to a "high confidence" candidate verifikat. We only attach the
 * suggestion when there is EXACTLY ONE candidate — multiple matches means
 * we can't auto-suggest without risking the wrong link. The user can still
 * open the full Matcha-dialog manually in that case.
 *
 * Done in a single SQL pass to keep listing performance reasonable:
 * fetch all 1630-lines for entries in the widest possible date window
 * covering all rows, then match in-memory.
 */
export async function findMatchSuggestionsBulk(
  supabase: SupabaseClient,
  companyId: string,
  rows: Array<{
    id: string
    transaktionsdatum: string
    belopp_skatteverket: number
    journal_entry_id: string | null
  }>,
): Promise<Map<string, SkattekontoMatchCandidate>> {
  const unmatched = rows.filter(r => !r.journal_entry_id)
  if (unmatched.length === 0) return new Map()

  const dates = unmatched.map(r => r.transaktionsdatum).sort()
  const from = addDays(dates[0], -DATE_WINDOW_DAYS)
  const to = addDays(dates[dates.length - 1], DATE_WINDOW_DAYS)

  const { data, error } = await supabase
    .from('journal_entry_lines')
    .select(
      `
        debit_amount,
        credit_amount,
        journal_entries!inner (
          id,
          voucher_number,
          voucher_series,
          entry_date,
          description,
          status,
          company_id
        )
      `,
    )
    .eq('account_number', SKATTEKONTO_ACCOUNT)
    .eq('journal_entries.company_id', companyId)
    .gte('journal_entries.entry_date', from)
    .lte('journal_entries.entry_date', to)
    .neq('journal_entries.status', 'reversed')

  if (error || !data) return new Map()

  type Row = {
    debit_amount: number
    credit_amount: number
    journal_entries: {
      id: string
      voucher_number: number | null
      voucher_series: string | null
      entry_date: string
      description: string
      status: 'draft' | 'posted' | 'reversed'
      company_id: string
    }
  }
  const lines = data as unknown as Row[]

  // Filter out entries already linked to another SKV row.
  const candidateEntryIds = Array.from(new Set(lines.map(l => l.journal_entries.id)))
  const { data: linked } = candidateEntryIds.length
    ? await supabase
        .from('skattekonto_transactions')
        .select('journal_entry_id')
        .eq('company_id', companyId)
        .in('journal_entry_id', candidateEntryIds)
    : { data: [] }

  const linkedSet = new Set(
    (linked ?? [])
      .map((l: { journal_entry_id: string | null }) => l.journal_entry_id)
      .filter((id): id is string => !!id),
  )

  const suggestions = new Map<string, SkattekontoMatchCandidate>()

  for (const row of unmatched) {
    const amount = Math.round(Math.abs(Number(row.belopp_skatteverket)) * 100) / 100
    const side = expectedSide(Number(row.belopp_skatteverket))
    const rowFrom = addDays(row.transaktionsdatum, -DATE_WINDOW_DAYS)
    const rowTo = addDays(row.transaktionsdatum, DATE_WINDOW_DAYS)

    const matches: SkattekontoMatchCandidate[] = []
    const seen = new Set<string>()

    for (const line of lines) {
      const e = line.journal_entries
      if (linkedSet.has(e.id)) continue
      if (seen.has(e.id)) continue
      if (e.entry_date < rowFrom || e.entry_date > rowTo) continue

      const debit = Math.round(Number(line.debit_amount) * 100) / 100
      const credit = Math.round(Number(line.credit_amount) * 100) / 100
      const lineMatches =
        side === 'debit'
          ? debit === amount && credit === 0
          : credit === amount && debit === 0
      if (!lineMatches) continue

      seen.add(e.id)
      matches.push({
        journal_entry_id: e.id,
        voucher_number: e.voucher_number,
        voucher_series: e.voucher_series,
        entry_date: e.entry_date,
        description: e.description,
        status: e.status,
        matched_amount: amount,
        matched_side: side,
      })

      if (matches.length > 1) break
    }

    // Auto-suggest only when there's a single unambiguous match.
    if (matches.length === 1) {
      suggestions.set(row.id, matches[0])
    }
  }

  return suggestions
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function expectedSide(beloppSkatteverket: number): 'debit' | 'credit' {
  // Positive SKV amount = money INTO skattekonto = 1630 increases = DEBIT 1630
  // Negative SKV amount = money OUT of skattekonto = 1630 decreases = CREDIT 1630
  return beloppSkatteverket > 0 ? 'debit' : 'credit'
}

/**
 * Find existing journal entries that look like the bank side of this
 * skattekonto row.
 *
 * Returns up to 25 candidates ordered by date proximity to the SKV row.
 */
export async function findMatchCandidates(
  supabase: SupabaseClient,
  companyId: string,
  transactionId: string,
): Promise<{ tx: StoredSkattekontoTransaction; candidates: SkattekontoMatchCandidate[] }> {
  const { data: tx, error: txError } = await supabase
    .from('skattekonto_transactions')
    .select('*')
    .eq('id', transactionId)
    .eq('company_id', companyId)
    .single<StoredSkattekontoTransaction>()

  if (txError || !tx) {
    throw new SkattekontoMatchError(
      'Skattekonto-transaktionen hittades inte.',
      'TRANSACTION_NOT_FOUND',
    )
  }

  if (tx.journal_entry_id) {
    throw new SkattekontoMatchError(
      'Transaktionen är redan kopplad till ett verifikat.',
      'ALREADY_BOOKED',
    )
  }

  const amount = Math.round(Math.abs(Number(tx.belopp_skatteverket)) * 100) / 100
  const side = expectedSide(Number(tx.belopp_skatteverket))
  const from = addDays(tx.transaktionsdatum, -DATE_WINDOW_DAYS)
  const to = addDays(tx.transaktionsdatum, DATE_WINDOW_DAYS)

  // Query 1630-lines with the right amount + side, joined to entries in
  // the date window. `!inner` filters out rows whose joined entry doesn't
  // match (Supabase pg-rest convention).
  let q = supabase
    .from('journal_entry_lines')
    .select(
      `
        debit_amount,
        credit_amount,
        journal_entries!inner (
          id,
          voucher_number,
          voucher_series,
          entry_date,
          description,
          status,
          company_id
        )
      `,
    )
    .eq('account_number', SKATTEKONTO_ACCOUNT)
    .eq('journal_entries.company_id', companyId)
    .gte('journal_entries.entry_date', from)
    .lte('journal_entries.entry_date', to)
    .neq('journal_entries.status', 'reversed')

  if (side === 'debit') {
    q = q.eq('debit_amount', amount).eq('credit_amount', 0)
  } else {
    q = q.eq('credit_amount', amount).eq('debit_amount', 0)
  }

  const { data: rows, error: rowsError } = await q.limit(50)
  if (rowsError) {
    throw new Error(`Kunde inte söka kandidater: ${rowsError.message}`)
  }

  type Row = {
    debit_amount: number
    credit_amount: number
    journal_entries: {
      id: string
      voucher_number: number | null
      voucher_series: string | null
      entry_date: string
      description: string
      status: 'draft' | 'posted' | 'reversed'
      company_id: string
    }
  }
  const typedRows = (rows ?? []) as unknown as Row[]

  if (typedRows.length === 0) {
    return { tx, candidates: [] }
  }

  // Filter out entries already linked to another skattekonto_transactions
  // row — those represent payments we've already accounted for.
  const candidateEntryIds = Array.from(new Set(typedRows.map(r => r.journal_entries.id)))
  const { data: linked } = await supabase
    .from('skattekonto_transactions')
    .select('journal_entry_id')
    .eq('company_id', companyId)
    .in('journal_entry_id', candidateEntryIds)

  const linkedSet = new Set(
    (linked ?? [])
      .map((l: { journal_entry_id: string | null }) => l.journal_entry_id)
      .filter((id): id is string => !!id),
  )

  const seen = new Set<string>()
  const candidates: SkattekontoMatchCandidate[] = []
  for (const row of typedRows) {
    const e = row.journal_entries
    if (linkedSet.has(e.id)) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    candidates.push({
      journal_entry_id: e.id,
      voucher_number: e.voucher_number,
      voucher_series: e.voucher_series,
      entry_date: e.entry_date,
      description: e.description,
      status: e.status,
      matched_amount: amount,
      matched_side: side,
    })
  }

  // Order by date proximity to the SKV row, then by voucher number desc.
  const target = new Date(tx.transaktionsdatum + 'T00:00:00Z').getTime()
  candidates.sort((a, b) => {
    const da = Math.abs(new Date(a.entry_date + 'T00:00:00Z').getTime() - target)
    const db = Math.abs(new Date(b.entry_date + 'T00:00:00Z').getTime() - target)
    if (da !== db) return da - db
    return (b.voucher_number ?? 0) - (a.voucher_number ?? 0)
  })

  return { tx, candidates: candidates.slice(0, 25) }
}

/**
 * Link a skattekonto_transactions row to an existing journal entry.
 *
 * Re-validates the candidate server-side: the entry must still belong to
 * the company, still have a 1630-line on the expected side with the
 * expected amount, and must not have been linked in the meantime.
 */
export async function matchSkattekontoToEntry(
  supabase: SupabaseClient,
  companyId: string,
  transactionId: string,
  journalEntryId: string,
): Promise<void> {
  const { data: tx, error: txError } = await supabase
    .from('skattekonto_transactions')
    .select('*')
    .eq('id', transactionId)
    .eq('company_id', companyId)
    .single<StoredSkattekontoTransaction>()

  if (txError || !tx) {
    throw new SkattekontoMatchError(
      'Skattekonto-transaktionen hittades inte.',
      'TRANSACTION_NOT_FOUND',
    )
  }
  if (tx.journal_entry_id) {
    throw new SkattekontoMatchError(
      'Transaktionen är redan kopplad till ett verifikat.',
      'ALREADY_BOOKED',
    )
  }

  const { data: entry, error: entryError } = await supabase
    .from('journal_entries')
    .select(
      `
        id,
        status,
        lines:journal_entry_lines (
          account_number,
          debit_amount,
          credit_amount
        )
      `,
    )
    .eq('id', journalEntryId)
    .eq('company_id', companyId)
    .single()

  if (entryError || !entry) {
    throw new SkattekontoMatchError(
      'Verifikatet hittades inte.',
      'ENTRY_NOT_FOUND',
    )
  }
  if (entry.status === 'reversed') {
    throw new SkattekontoMatchError(
      'Verifikatet är makulerat och kan inte matchas.',
      'INVALID_CANDIDATE',
    )
  }

  const amount = Math.round(Math.abs(Number(tx.belopp_skatteverket)) * 100) / 100
  const side = expectedSide(Number(tx.belopp_skatteverket))
  type Line = { account_number: string; debit_amount: number; credit_amount: number }
  const hasMatchingLine = (entry.lines as Line[] | null)?.some(l => {
    if (l.account_number !== SKATTEKONTO_ACCOUNT) return false
    const debit = Math.round(Number(l.debit_amount) * 100) / 100
    const credit = Math.round(Number(l.credit_amount) * 100) / 100
    return side === 'debit'
      ? debit === amount && credit === 0
      : credit === amount && debit === 0
  })

  if (!hasMatchingLine) {
    throw new SkattekontoMatchError(
      'Verifikatet saknar en matchande rad på 1630.',
      'INVALID_CANDIDATE',
    )
  }

  const { data: alreadyLinked } = await supabase
    .from('skattekonto_transactions')
    .select('id')
    .eq('company_id', companyId)
    .eq('journal_entry_id', journalEntryId)
    .maybeSingle()

  if (alreadyLinked) {
    throw new SkattekontoMatchError(
      'Verifikatet är redan kopplat till en annan skattekonto-transaktion.',
      'ENTRY_ALREADY_LINKED',
    )
  }

  const { error: updateError } = await supabase
    .from('skattekonto_transactions')
    .update({ journal_entry_id: journalEntryId })
    .eq('id', transactionId)
    .eq('company_id', companyId)
    .is('journal_entry_id', null) // guard against concurrent updates

  if (updateError) {
    throw new Error(`Kunde inte koppla transaktionen: ${updateError.message}`)
  }
}
