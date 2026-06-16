import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { eventBus } from '@/lib/events'
import { ensureInitialized } from '@/lib/init'
import { createJournalEntry } from '@/lib/bookkeeping/engine'
import { bookkeepingErrorResponse } from '@/lib/bookkeeping/errors'
import { validateBody } from '@/lib/api/validate'
import { BookTransactionSchema } from '@/lib/api/schemas'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'
import { detectBookedDuplicateTransaction } from '@/lib/transactions/booking-duplicate-detection'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { createLogger } from '@/lib/logger'
import type { Transaction } from '@/types'

ensureInitialized()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { id } = await params

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  const validation = await validateBody(request, BookTransactionSchema)
  if (!validation.success) return validation.response
  const { fiscal_period_id, entry_date, description, lines, force, expected_duplicate_transaction_id } = validation.data

  // Fetch transaction (validates ownership)
  const { data: transaction, error: fetchError } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (fetchError || !transaction) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  // Reject if already booked
  if (transaction.journal_entry_id) {
    return NextResponse.json(
      { error: 'Transaction already has a journal entry' },
      { status: 409 }
    )
  }

  // Booking-time duplicate guard: if another transaction with the same
  // date+amount+account is already booked, booking this one would double-count
  // one real event (two verifikationer — felaktig bokföring per BFL). Warn; the
  // user confirms with force=true bound to the reviewed sibling. Mirrors the
  // match-invoice soft-duplicate guard.
  const dupLog = createLogger('transactions.book', { companyId, userId: user.id })
  try {
    const candidate = await detectBookedDuplicateTransaction(supabase, companyId, {
      id,
      date: transaction.date,
      amount: transaction.amount,
      cash_account_id: transaction.cash_account_id ?? null,
    })
    if (!force) {
      if (candidate) {
        return errorResponseFromCode('TRANSACTION_BOOK_POSSIBLE_DUPLICATE', dupLog, {
          details: { candidate },
        })
      }
    } else if (!candidate || candidate.transaction_id !== expected_duplicate_transaction_id) {
      // force=true is bound to a specific candidate. Re-detect and refuse the
      // bypass unless it still matches, so a guessed id can't wave the guard.
      return errorResponseFromCode('TRANSACTION_BOOK_FORCE_CANDIDATE_MISMATCH', dupLog, {
        details: {
          expected_duplicate_transaction_id: expected_duplicate_transaction_id ?? null,
          detected_transaction_id: candidate?.transaction_id ?? null,
        },
      })
    } else {
      dupLog.warn('booking-time duplicate guard bypassed', {
        reason: 'force=true',
        transactionId: id,
        dismissedTransactionId: candidate.transaction_id,
      })
    }
  } catch (err) {
    // Detection is fail-open for the non-force path; force requires a confirmed
    // candidate, so a detection failure under force is rejected as a mismatch.
    if (force) {
      return errorResponseFromCode('TRANSACTION_BOOK_FORCE_CANDIDATE_MISMATCH', dupLog, {
        details: { detection_failed: true },
      })
    }
    dupLog.warn('booking-time duplicate detection failed (continuing)', err as Error)
  }

  // Create journal entry via the engine
  let journalEntry
  try {
    journalEntry = await createJournalEntry(supabase, companyId, user.id, {
      fiscal_period_id,
      entry_date,
      description,
      source_type: 'bank_transaction',
      source_id: id,
      lines,
    })
  } catch (err) {
    const typed = bookkeepingErrorResponse(err)
    if (typed) return typed
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create journal entry' },
      { status: 400 }
    )
  }

  // Link transaction to the journal entry
  const { error: updateError } = await supabase
    .from('transactions')
    .update({
      journal_entry_id: journalEntry.id,
      is_business: true,
      category: 'uncategorized',
    })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json(
      { error: 'Failed to update transaction' },
      { status: 500 }
    )
  }

  // Emit event (non-blocking)
  try {
    await eventBus.emit({
      type: 'transaction.categorized',
      payload: {
        transaction: transaction as Transaction,
        account: lines[0]?.account_number || '',
        taxCode: '',
        userId: user.id,
        companyId,
      },
    })
  } catch {
    // Non-critical
  }

  return NextResponse.json({
    data: journalEntry,
    journal_entry_id: journalEntry.id,
    success: true,
  })
}
