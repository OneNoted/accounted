/**
 * Re-validation at accept time.
 *
 * A pending proposal can become stale between generation and accept:
 *   * matched transaction gets deleted or already booked
 *   * fiscal period closed or locked
 *   * account deactivated in the chart
 *   * inbox item already linked to a journal entry via a manual path
 *
 * This module runs the relevant checks and returns a typed error the API
 * route translates to a structured response the UI can act on (e.g.,
 * "period closed — reopen it or change the entry date").
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AIProposal,
  BookingProposalPayload,
  MatchProposalPayload,
  InvoiceInboxItem,
} from '@/types'

export type ValidationFailureCode =
  | 'inbox_item_missing'
  | 'inbox_item_already_booked'
  | 'transaction_missing'
  | 'transaction_already_booked'
  | 'transaction_already_matched_elsewhere'
  | 'period_missing_or_closed'
  | 'account_missing_or_inactive'
  | 'step_prerequisite_missing'

export interface ValidationSuccess {
  ok: true
  inboxItem: InvoiceInboxItem
}

export interface ValidationFailure {
  ok: false
  code: ValidationFailureCode
  message: string
  details?: Record<string, unknown>
}

export type ValidationResult = ValidationSuccess | ValidationFailure

export async function reValidateProposal(
  supabase: SupabaseClient,
  companyId: string,
  proposal: AIProposal
): Promise<ValidationResult> {
  if (proposal.subject_type !== 'inbox_item') {
    return {
      ok: false,
      code: 'step_prerequisite_missing',
      message: 'Endast inkorgsobjekt stöds i denna version.',
    }
  }

  // Common: the inbox item still exists.
  const { data: inboxItem, error: inboxError } = await supabase
    .from('invoice_inbox_items')
    .select('*')
    .eq('id', proposal.subject_id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (inboxError || !inboxItem) {
    return {
      ok: false,
      code: 'inbox_item_missing',
      message: 'Kvittot/fakturan finns inte längre.',
    }
  }

  const item = inboxItem as InvoiceInboxItem

  // If the document has already been booked via another path, skip.
  if (item.status === 'confirmed') {
    return {
      ok: false,
      code: 'inbox_item_already_booked',
      message: 'Detta dokument är redan bokfört manuellt.',
    }
  }

  if (proposal.step_type === 'match') {
    return reValidateMatch(supabase, companyId, item, proposal.proposal_json as MatchProposalPayload)
  }

  if (proposal.step_type === 'booking') {
    return reValidateBooking(supabase, companyId, item, proposal.proposal_json as BookingProposalPayload)
  }

  return {
    ok: false,
    code: 'step_prerequisite_missing',
    message: `Okänt stegtyp: ${proposal.step_type}`,
  }
}

async function reValidateMatch(
  supabase: SupabaseClient,
  companyId: string,
  item: InvoiceInboxItem,
  payload: MatchProposalPayload
): Promise<ValidationResult> {
  const txId = payload.matched_transaction_id

  const { data: tx } = await supabase
    .from('transactions')
    .select('id, journal_entry_id, company_id')
    .eq('id', txId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!tx) {
    return {
      ok: false,
      code: 'transaction_missing',
      message: 'Den föreslagna transaktionen finns inte längre.',
    }
  }

  if (tx.journal_entry_id) {
    return {
      ok: false,
      code: 'transaction_already_booked',
      message: 'Transaktionen är redan bokförd.',
    }
  }

  // Another inbox item may have claimed this transaction via the existing
  // smart-match partial unique index.
  const { data: claimingInbox } = await supabase
    .from('invoice_inbox_items')
    .select('id')
    .eq('matched_transaction_id', txId)
    .eq('company_id', companyId)
    .neq('id', item.id)
    .maybeSingle()

  if (claimingInbox) {
    return {
      ok: false,
      code: 'transaction_already_matched_elsewhere',
      message: 'Transaktionen är redan matchad till ett annat dokument.',
    }
  }

  return { ok: true, inboxItem: item }
}

async function reValidateBooking(
  supabase: SupabaseClient,
  companyId: string,
  item: InvoiceInboxItem,
  payload: BookingProposalPayload
): Promise<ValidationResult> {
  if (!item.matched_transaction_id) {
    return {
      ok: false,
      code: 'step_prerequisite_missing',
      message: 'Ingen matchande transaktion — stäng först matchningssteget.',
    }
  }

  // The transaction still exists and is still unbooked.
  const { data: tx } = await supabase
    .from('transactions')
    .select('id, journal_entry_id')
    .eq('id', item.matched_transaction_id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!tx) {
    return {
      ok: false,
      code: 'transaction_missing',
      message: 'Den matchade transaktionen finns inte längre.',
    }
  }

  if (tx.journal_entry_id) {
    return {
      ok: false,
      code: 'transaction_already_booked',
      message: 'Transaktionen har redan bokförts.',
    }
  }

  // Fiscal period is open.
  const { data: period } = await supabase
    .from('fiscal_periods')
    .select('id, is_closed, locked_at')
    .eq('id', payload.fiscal_period_id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!period || period.is_closed || period.locked_at) {
    return {
      ok: false,
      code: 'period_missing_or_closed',
      message: 'Räkenskapsåret är låst eller finns inte längre.',
    }
  }

  // All accounts in the proposed lines are active in the chart.
  const accountNumbers = [...new Set(payload.lines.map((l) => l.account_number))]
  const { data: accounts } = await supabase
    .from('chart_of_accounts')
    .select('account_number, is_active')
    .eq('company_id', companyId)
    .in('account_number', accountNumbers)

  const foundActive = new Set(
    (accounts || []).filter((a) => a.is_active).map((a) => a.account_number)
  )
  const missing = accountNumbers.filter((n) => !foundActive.has(n))

  if (missing.length > 0) {
    return {
      ok: false,
      code: 'account_missing_or_inactive',
      message: `Kontona saknas eller är inaktiva: ${missing.join(', ')}`,
      details: { missing_accounts: missing },
    }
  }

  return { ok: true, inboxItem: item }
}
