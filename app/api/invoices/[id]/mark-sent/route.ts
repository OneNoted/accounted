import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createInvoiceJournalEntry } from '@/lib/bookkeeping/invoice-entries'
import { booksInvoicesOnIssue } from '@/lib/bookkeeping/booking-mode'
import { createSchedulesForCustomerInvoice } from '@/lib/bookkeeping/accruals/from-invoices'
import { eventBus } from '@/lib/events'
import { ensureInvoiceNumber } from '@/lib/invoices/ensure-invoice-number'
import {
  creditNoteNeedsJournalEntry,
  issueCreditNote,
  type CreditNoteOriginalInvoice,
} from '@/lib/invoices/issue-credit-note'
import { ensureInitialized } from '@/lib/init'
import { withRouteContext } from '@/lib/api/with-route-context'
import { MarkInvoiceSentSchema } from '@/lib/api/schemas'
import { roundOre } from '@/lib/money'
import { InvoicePDF } from '@/lib/invoices/pdf-template'
import { prepareInvoicePdfRender, buildSwishQrDataUrl } from '@/lib/invoices/pdf-render-helpers'
import { uploadDocument } from '@/lib/core/documents/document-service'
import { errorResponseFromCode } from '@/lib/errors/get-structured-error'
import type {
  AccountingMethod,
  CompanySettings,
  CreditNote,
  Customer,
  EntityType,
  Invoice,
  InvoiceItem,
} from '@/types'

ensureInitialized()

/**
 * POST /api/invoices/[id]/mark-sent
 *
 * Manually marks a draft invoice as sent (for invoices delivered outside the system).
 * Under faktureringsmetoden (accrual): creates the journal entry (Debit 1510, Credit 30xx/26xx).
 * Under kontantmetoden (cash): no journal entry; booking happens at payment.
 */
export const POST = withRouteContext<{ params: Promise<{ id: string }> }>(
  'invoice.mark_sent',
  async (request, { supabase, user, companyId, log, requestId }, { params }) => {
  const { id } = await params

  // Optional body. Backwards-compat: callers may POST with no body.
  let customLines:
    | {
        account_number: string
        debit_amount: number
        credit_amount: number
        line_description?: string
        dimensions?: Record<string, string>
      }[]
    | undefined
  let rawBody: unknown
  try {
    const text = await request.text()
    if (text) rawBody = JSON.parse(text)
  } catch {
    // Empty / invalid body: fall through to defaults.
  }

  if (rawBody) {
    const parsed = MarkInvoiceSentSchema.safeParse(rawBody)
    if (!parsed.success) {
      log.warn('mark-sent validation failed', {
        issueCount: parsed.error.issues.length,
      })
      return NextResponse.json(
        { error: 'Ogiltig förfrågan', details: parsed.error.flatten() },
        { status: 400 },
      )
    }
    customLines = parsed.data.lines
  }

  if (customLines) {
    // Sum per-line öre-rounded amounts: the engine rounds each line before
    // insert, so raw sums that balance can still book unbalanced otherwise.
    const totalDebit = customLines.reduce((s, l) => s + roundOre(l.debit_amount), 0)
    const totalCredit = customLines.reduce((s, l) => s + roundOre(l.credit_amount), 0)
    if (Math.round((totalDebit - totalCredit) * 100) !== 0 || totalDebit <= 0) {
      return errorResponseFromCode('INVOICE_MARK_SENT_LINES_UNBALANCED', log, {
        requestId,
        details: { totalDebit, totalCredit },
      })
    }
  }

  // Fetch invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*, customer:customers(*), items:invoice_items(*)')
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (invoiceError || !invoice) {
    return errorResponseFromCode('INVOICE_NOT_FOUND', log, { requestId })
  }

  const isCreditNote = !!invoice.credited_invoice_id

  if (!isCreditNote && invoice.status !== 'draft') {
    return errorResponseFromCode('INVOICE_MARK_SENT_INVALID_STATUS', log, { requestId })
  }
  if (isCreditNote && !['draft', 'sent'].includes(invoice.status)) {
    return errorResponseFromCode('INVOICE_MARK_SENT_INVALID_STATUS', log, { requestId })
  }

  // Assign invoice number now if this draft doesn't have one yet
  try {
    await ensureInvoiceNumber(supabase, companyId, invoice as Invoice)
  } catch (err) {
    log.error('failed to assign invoice number on mark-sent', err as Error)
    return errorResponseFromCode('INVOICE_CREATE_NUMBER_ASSIGN_FAILED', log, { requestId })
  }

  // Fetch full company settings for PDF rendering and accounting method
  const { data: settings, error: settingsError } = await supabase
    .from('company_settings')
    .select('*')
    .eq('company_id', companyId)
    .single()

  if (settingsError || !settings) {
    return errorResponseFromCode('INVOICE_SEND_COMPANY_SETTINGS_MISSING', log, { requestId })
  }

  const accountingMethod = (settings.accounting_method || 'accrual') as AccountingMethod
  const entityType = (settings.entity_type as EntityType) || 'enskild_firma'
  let originalInvoice: CreditNoteOriginalInvoice | undefined
  let originalInvoiceNumber: string | undefined

  if (invoice.credited_invoice_id) {
    const { data: original } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, journal_entry_id, paid_at, paid_amount, total')
      .eq('id', invoice.credited_invoice_id)
      .eq('company_id', companyId)
      .single()

    if (!original) {
      return errorResponseFromCode('INVOICE_CREDIT_ORIGINAL_NOT_FOUND', log, { requestId })
    }

    originalInvoice = original as CreditNoteOriginalInvoice
    originalInvoiceNumber = original.invoice_number ?? undefined
  }

  const journalEntryRequired = originalInvoice
    ? creditNoteNeedsJournalEntry(accountingMethod, originalInvoice)
    : false
  const isRecovery = isCreditNote && invoice.status === 'sent'

  if (
    isRecovery &&
    originalInvoice?.status === 'credited' &&
    (!journalEntryRequired || !!invoice.journal_entry_id)
  ) {
    return errorResponseFromCode('INVOICE_CREDIT_ALREADY_ISSUED', log, { requestId })
  }

  // Compare-and-set prevents two concurrent requests from posting two journal
  // entries for the same draft.
  let statusFlipped = false
  if (!isRecovery) {
    const { data: updatedRows, error: updateError } = await supabase
      .from('invoices')
      .update({ status: 'sent' })
      .eq('id', id)
      .eq('company_id', companyId)
      .eq('status', 'draft')
      .select('id')

    if (updateError) {
      log.error('invoice mark-sent status update failed', updateError)
      return errorResponseFromCode('INVOICE_MARK_SENT_STATUS_FAILED', log, { requestId })
    }
    if (!updatedRows || updatedRows.length === 0) {
      return errorResponseFromCode('INVOICE_MARK_SENT_RACE', log, { requestId })
    }
    statusFlipped = true
  }

  // Only create journal entries for real invoices (not proformas or delivery notes)
  const isRealInvoice = !invoice.document_type || invoice.document_type === 'invoice'
  let journalEntryId: string | null = null
  const partialFailures: Array<{ step: string; reason: string }> = []

  if (isCreditNote && originalInvoice) {
    const issueResult = await issueCreditNote({
      supabase,
      companyId,
      userId: user.id,
      creditNote: invoice as CreditNote,
      originalInvoice,
      entityType,
      accountingMethod,
      log,
    })
    journalEntryId = issueResult.journalEntryId
    partialFailures.push(...issueResult.failures)

    if (!issueResult.complete) {
      // If no immutable entry was created, restoring the draft is safe and
      // lets the user fix the period/account issue before trying again.
      if (statusFlipped && issueResult.journalEntryRequired && !issueResult.journalEntryId) {
        await supabase
          .from('invoices')
          .update({ status: 'draft' })
          .eq('id', id)
          .eq('company_id', companyId)
          .eq('status', 'sent')
          .is('journal_entry_id', null)
      }
      return errorResponseFromCode(
        issueResult.repairRequired
          ? 'INVOICE_CREDIT_REPAIR_REQUIRED'
          : 'INVOICE_CREDIT_ISSUE_INCOMPLETE',
        log,
        {
          requestId,
          details: { failure_steps: issueResult.failures.map((failure) => failure.step) },
        },
      )
    }
  } else if (isRealInvoice && booksInvoicesOnIssue(settings as CompanySettings)) {
    // #967: deferred companies fall past this branch (mark-sent WITHOUT
    // booking); ekonomi books later via POST /api/invoices/[id]/book, like
    // under kontantmetoden.
    try {
      const journalEntry = customLines
        ? await createInvoiceJournalEntry(
            supabase,
            companyId,
            user.id,
            invoice as Invoice,
            entityType,
            invoice.customer?.name,
            { customLines },
          )
        : await createInvoiceJournalEntry(
            supabase,
            companyId,
            user.id,
            invoice as Invoice,
            entityType,
            invoice.customer?.name,
          )
      if (journalEntry) {
        journalEntryId = journalEntry.id

        // Periodiserade lines: create schedules + catch-up dissolutions now
        // that the revenue entry exists. Failures are logged, never fatal:
        // the verifikat is committed. Skipped when the user edited the lines:
        // the generated 29xx deferral may no longer exist in what was booked,
        // and a schedule would then dissolve an interim balance that was
        // never credited. User-edited lines book exactly as reviewed.
        if (!customLines) {
          const accrual = await createSchedulesForCustomerInvoice(
            supabase,
            companyId,
            user.id,
            invoice as Invoice,
            (invoice.items as InvoiceItem[] | null) ?? [],
            journalEntry.id,
            entityType,
          )
          if (accrual.failed > 0) {
            log.error('accrual schedule creation failed on mark-sent', {
              failed: accrual.failed,
            })
            partialFailures.push({
              step: 'accrual_schedules',
              reason: `${accrual.failed} periodisering(ar) kunde inte skapas`,
            })
          }
        }

        const { error: linkError } = await supabase
          .from('invoices')
          .update({ journal_entry_id: journalEntry.id })
          .eq('id', id)
        if (linkError) {
          // Don't fail mark-sent: the verifikat committed; only the link
          // failed. But log it through the structured logger so it reaches log
          // aggregation/alerting: this write silently no-ops when the
          // journal_entry_id column is missing (it was absent in prod until the
          // 20260613100000 migration), which leaves mark-paid unable to detect
          // an already-booked sale.
          log.error('mark-sent: journal_entry_id link to invoice failed', linkError, {
            journalEntryId: journalEntry.id,
          })
          partialFailures.push({
            step: 'journal_link',
            reason: 'Verifikatet skapades men kunde inte kopplas till fakturan.',
          })
        }
      } else {
        partialFailures.push({
          step: 'journal_entry',
          reason: 'Ingen öppen bokföringsperiod hittades för fakturans datum.',
        })
      }
    } catch (err) {
      log.error('failed to create invoice journal entry on mark-sent', err as Error)
      partialFailures.push({
        step: 'journal_entry',
        reason: 'Fakturans verifikat kunde inte skapas.',
      })
    }
  }

  // Fail-closed only when inline booking was supposed to happen: deferred
  // (#967) and cash-method invoices are legitimately unbooked at this point.
  if (isRealInvoice && booksInvoicesOnIssue(settings as CompanySettings) && !isCreditNote && !journalEntryId) {
    if (statusFlipped) {
      const { error: rollbackError } = await supabase
        .from('invoices')
        .update({ status: 'draft' })
        .eq('id', id)
        .eq('company_id', companyId)
        .eq('status', 'sent')
        .is('journal_entry_id', null)
      if (rollbackError) log.error('failed to restore draft after mark-sent booking failure', rollbackError)
    }
    return errorResponseFromCode('INVOICE_MARK_SENT_BOOK_FAILED', log, { requestId })
  }

  if (partialFailures.some((failure) => failure.step === 'journal_link')) {
    return errorResponseFromCode('INVOICE_MARK_SENT_REPAIR_REQUIRED', log, {
      requestId,
      details: { failure_steps: ['journal_link'] },
    })
  }

  // Render and archive the PDF as underlag so it remains retrievable even if
  // the invoice row is later cancelled. Mirrors the send route.
  if (isRealInvoice) {
    try {
      const items = (invoice.items as InvoiceItem[] | null ?? []).slice().sort(
        (a, b) => a.sort_order - b.sort_order
      )

      // The DB status flip already happened above, but the in-memory `invoice`
      // is stale and still reads 'draft': override here so the archived
      // underlag isn't stamped "UTKAST: inte en giltig faktura".
      const renderableInvoice = { ...(invoice as Invoice), status: 'sent' as const }
      const { branding, company: renderCompany } = await prepareInvoicePdfRender(
        settings as CompanySettings,
      )
      const swishQrDataUrl = await buildSwishQrDataUrl(settings as CompanySettings, renderableInvoice)
      const pdfBuffer = await renderToBuffer(
        InvoicePDF({
          invoice: renderableInvoice,
          customer: invoice.customer as Customer,
          items,
          company: renderCompany,
          originalInvoiceNumber,
          branding,
          swishQrDataUrl,
        })
      )

      const filename = invoice.credited_invoice_id
        ? `kreditfaktura-${invoice.invoice_number}.pdf`
        : `faktura-${invoice.invoice_number}.pdf`

      const pdfArrayBuffer = new Uint8Array(pdfBuffer).buffer as ArrayBuffer
      await uploadDocument(supabase, user.id, companyId, {
        name: filename,
        buffer: pdfArrayBuffer,
        type: 'application/pdf',
      }, {
        upload_source: 'system',
        journal_entry_id: journalEntryId ?? undefined,
      })
    } catch (err) {
      log.error('failed to archive invoice PDF on mark-sent', err as Error)
      partialFailures.push({
        step: 'pdf_archive',
        reason: 'Fakturans PDF kunde inte arkiveras.',
      })
    }
  }

  if (!isCreditNote) {
    await eventBus.emit({
      type: 'invoice.sent',
      payload: { invoice: { ...(invoice as Invoice), status: 'sent' }, companyId, userId: user.id },
    })
  }

  return NextResponse.json({
    success: true,
    status: 'sent',
    journal_entry_id: journalEntryId,
    ...(partialFailures.length > 0
      ? { partial: true, partial_failures: partialFailures }
      : {}),
  })
  },
  { requireWrite: true },
)
