/**
 * POST /api/v1/companies/{companyId}/invoices/{id}/send
 *
 * Full send pipeline. Renders the invoice PDF, emails it to the customer
 * (with a copy to the company), allocates the F-series number, posts the
 * journal entry under accrual basis, archives the PDF as underlag, and
 * emits invoice.sent. This is :mark-sent + PDF + email + archival.
 *
 * Failure ordering (matches the dashboard's internal /api/invoices/[id]/send
 * exactly so the two surfaces stay reconcilable):
 *
 *   1. Email service NOT configured → 503 INVOICE_SEND_EMAIL_NOT_CONFIGURED.
 *      Hard fail before any state changes.
 *   2. Customer has no email → 400 INVOICE_SEND_NO_CUSTOMER_EMAIL.
 *   3. Company settings missing → 404 INVOICE_SEND_COMPANY_SETTINGS_MISSING.
 *   4. Cancelled invoices are rejected — sending one would silently
 *      re-activate it (the status flip below has no race guard tightening
 *      `cancelled`). Returns 400 INVOICE_SEND_CANCELLED.
 *   5. Preflight PDF render (with a placeholder F-PREVIEW number) validates
 *      the rendering pipeline BEFORE consuming an F-series number. Fail →
 *      500 INVOICE_SEND_PDF_RENDER_FAILED, no number burned.
 *   6. ensureInvoiceNumber allocates the F-series number atomically.
 *      Fail → 500 INVOICE_SEND_NUMBER_ASSIGN_FAILED.
 *   7. Final PDF render with the real number.
 *   8. Email send via Resend (the email extension). Fail → 502
 *      INVOICE_SEND_PROVIDER_FAILED. The number IS consumed at this point;
 *      same orphan-window as :mark-sent (architecturally tracked).
 *   9. POINT OF NO RETURN. Steps below are best-effort; failures surface
 *      as `warnings` on the response. Status flip → 'sent', journal entry
 *      (accrual + real invoice), PDF archival via uploadDocument,
 *      invoice.sent event emission.
 *
 * Idempotent (mandatory Idempotency-Key). Dry-runnable — dry-run goes
 * through steps 1–5 (validation + preflight PDF) without allocating a
 * number, sending email, or mutating state.
 */

import { z } from 'zod'
import { renderToBuffer } from '@react-pdf/renderer'
import { ok } from '@/lib/api/v1/response'
import { dryRunPreview } from '@/lib/api/v1/dry-run'
import { registerEndpoint } from '@/lib/api/v1/registry'
import { withApiV1 } from '@/lib/api/v1/with-api-v1'
import { v1ErrorResponse, v1ErrorResponseFromCode } from '@/lib/api/v1/errors'
import { InvoicePDF } from '@/lib/invoices/pdf-template'
import { getEmailService } from '@/lib/email/service'
import {
  generateInvoiceEmailHtml,
  generateInvoiceEmailSubject,
  generateInvoiceEmailText,
} from '@/lib/email/invoice-templates'
import { createInvoiceJournalEntry } from '@/lib/bookkeeping/invoice-entries'
import { uploadDocument } from '@/lib/core/documents/document-service'
import { ensureInvoiceNumber } from '@/lib/invoices/ensure-invoice-number'
import { eventBus } from '@/lib/events'
import type { CompanySettings, Customer, EntityType, Invoice, InvoiceItem } from '@/types'

const INVOICE_SEND_RESPONSE_COLUMNS =
  'id, invoice_number, customer_id, invoice_date, due_date, delivery_date, status, currency, exchange_rate, exchange_rate_date, subtotal, subtotal_sek, vat_amount, vat_amount_sek, total, total_sek, vat_treatment, vat_rate, moms_ruta, your_reference, our_reference, notes, reverse_charge_text, credited_invoice_id, document_type, converted_from_id, paid_at, paid_amount, remaining_amount, created_at, updated_at'

const InvoiceSendResponse = z.object({
  id: z.string().uuid(),
  invoice_number: z.string(),
  status: z.literal('sent'),
  total: z.number(),
  message_id: z.string().nullable(),
  sent_to: z.string(),
  cc: z.string().nullable(),
  journal_entry_id: z.string().uuid().nullable(),
  warnings: z
    .array(z.object({ code: z.string(), message: z.string() }))
    .optional(),
})

registerEndpoint({
  operation: 'invoices.send',
  method: 'POST',
  path: '/api/v1/companies/:companyId/invoices/:id/send',
  summary: 'Send a draft invoice to the customer by email.',
  description:
    'The full send pipeline: preflight PDF render → allocate F-series number atomically → final PDF render → email via Resend (PDF attachment, copy to company) → flip status to sent → post journal entry (accrual + real invoice) → archive PDF as underlag → emit invoice.sent. Email failure is a hard 502 before state changes; post-email failures surface as warnings but the invoice IS marked sent.',
  useWhen:
    'You want gnubok to deliver the invoice to the customer via email. For invoices delivered through another channel (Peppol, postal, own SMTP) use :mark-sent instead.',
  doNotUseFor:
    'Re-sending an already-sent invoice (returns 409 INVOICE_UPDATE_NOT_DRAFT). Sending a delivery note (no F-series lifecycle). Sending a credit note (use the :credit endpoint to issue the kreditfaktura; subsequent re-send of the credit note via :mark-sent is the supported path).',
  pitfalls: [
    'Idempotency-Key is mandatory.',
    'Email service must be configured — without RESEND_API_KEY + RESEND_FROM_EMAIL the endpoint returns 503 INVOICE_SEND_EMAIL_NOT_CONFIGURED.',
    'Customer must have an email address. 400 INVOICE_SEND_NO_CUSTOMER_EMAIL otherwise.',
    'A cancelled invoice is rejected (400 INVOICE_SEND_CANCELLED) — its F-series number is preserved for compliance but the document is not a valid faktura.',
    'Email failure before the status flip leaves the F-series number consumed but the invoice in `draft` status. Same orphan window as :mark-sent (architecturally tracked, matches internal route).',
    'After the email succeeds, journal-entry/archive/event failures become warnings on the response; the invoice IS marked sent regardless.',
  ],
  example: {
    response: {
      data: {
        id: '0e9c…',
        invoice_number: '2026-0042',
        status: 'sent',
        total: 12500,
        message_id: 're_abc123',
        sent_to: 'finance@acme.test',
        cc: 'billing@gnubok-user.test',
        journal_entry_id: '7b3a…',
      },
      meta: { request_id: 'req_…', api_version: '2026-05-12' },
    },
  },
  scope: 'invoices:write',
  risk: 'high',
  idempotent: true,
  reversible: false,
  dryRunSupported: true,
  response: { success: InvoiceSendResponse },
})

export const POST = withApiV1<{ params: Promise<{ companyId: string; id: string }> }>(
  'invoices.send',
  async (_request, ctx, params) => {
    const { id } = await params.params

    const idParse = z.string().uuid().safeParse(id)
    if (!idParse.success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'id', message: 'Invoice id must be a UUID.' },
      })
    }
    const invoiceId = idParse.data

    if (!z.string().uuid().safeParse(ctx.companyId).success) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: { field: 'companyId', message: 'companyId must be a UUID.' },
      })
    }

    // Step 1: email service configured?
    const emailService = getEmailService()
    if (!emailService.isConfigured()) {
      return v1ErrorResponseFromCode('INVOICE_SEND_EMAIL_NOT_CONFIGURED', ctx.log, {
        requestId: ctx.requestId,
      })
    }

    // Fetch invoice + customer + items.
    const { data: invoice, error: fetchErr } = await ctx.supabase
      .from('invoices')
      .select(
        `${INVOICE_SEND_RESPONSE_COLUMNS}, customer:customers(id, name, email, customer_type, country, address_line1, address_line2, postal_code, city, vat_number), items:invoice_items(id, sort_order, description, quantity, unit, unit_price, line_total, vat_rate, vat_amount)`,
      )
      .eq('company_id', ctx.companyId!)
      .eq('id', invoiceId)
      .maybeSingle()

    if (fetchErr) {
      return v1ErrorResponse(fetchErr, ctx.log, { requestId: ctx.requestId })
    }
    if (!invoice) {
      ctx.log.warn('invoices.send: not found', { invoiceId, companyId: ctx.companyId })
      return v1ErrorResponseFromCode('NOT_FOUND', ctx.log, {
        requestId: ctx.requestId,
        details: { resource: 'invoice' },
      })
    }

    const typed = invoice as unknown as Invoice & {
      customer?: Customer
      items?: InvoiceItem[]
    }

    // Step 4: cancelled invoices.
    if (typed.status === 'cancelled') {
      return v1ErrorResponseFromCode('INVOICE_SEND_CANCELLED', ctx.log, {
        requestId: ctx.requestId,
      })
    }

    // Reject already-sent — same contract as :mark-sent. Re-send is not a
    // supported v1 operation; use the dashboard or a fresh credit-and-reissue.
    if (typed.status !== 'draft') {
      return v1ErrorResponseFromCode('INVOICE_UPDATE_NOT_DRAFT', ctx.log, {
        requestId: ctx.requestId,
        details: { current_status: typed.status },
      })
    }

    // Reject delivery notes — they have a different (D-series) lifecycle.
    if (typed.document_type === 'delivery_note') {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: {
          field: 'document_type',
          message: 'Delivery notes are not sent via this endpoint; use the dashboard or a custom channel.',
        },
      })
    }

    if (!typed.moms_ruta) {
      return v1ErrorResponseFromCode('VALIDATION_ERROR', ctx.log, {
        requestId: ctx.requestId,
        details: {
          field: 'moms_ruta',
          message: 'Invoice has no moms_ruta set; re-create the draft via POST /invoices.',
        },
      })
    }

    // Step 2: customer email.
    const customer = typed.customer
    if (!customer?.email) {
      return v1ErrorResponseFromCode('INVOICE_SEND_NO_CUSTOMER_EMAIL', ctx.log, {
        requestId: ctx.requestId,
        details: { customer_id: typed.customer_id },
      })
    }

    // Step 3: company settings.
    const { data: company, error: companyErr } = await ctx.supabase
      .from('company_settings')
      .select('*')
      .eq('company_id', ctx.companyId!)
      .maybeSingle()
    if (companyErr || !company) {
      return v1ErrorResponseFromCode('INVOICE_SEND_COMPANY_SETTINGS_MISSING', ctx.log, {
        requestId: ctx.requestId,
      })
    }
    const settings = company as CompanySettings & { accounting_method?: string }

    const items = (typed.items ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)

    // Look up the original invoice's number if this is a credit note.
    let originalInvoiceNumber: string | undefined
    if (typed.credited_invoice_id) {
      const { data: orig } = await ctx.supabase
        .from('invoices')
        .select('invoice_number')
        .eq('id', typed.credited_invoice_id)
        .eq('company_id', ctx.companyId!)
        .maybeSingle()
      if (orig) originalInvoiceNumber = (orig as { invoice_number?: string }).invoice_number ?? undefined
    }

    // Step 5: preflight PDF render. Validate the pipeline with a placeholder
    // number BEFORE consuming an F-series number.
    const isFreshAllocation = !typed.invoice_number
    if (isFreshAllocation) {
      try {
        await renderToBuffer(
          InvoicePDF({
            invoice: { ...(typed as Invoice), invoice_number: 'F-PREVIEW' },
            customer,
            items,
            company: settings,
            originalInvoiceNumber,
          }),
        )
      } catch (err) {
        ctx.log.error('invoices.send: preflight PDF render failed', err as Error, {
          invoiceId,
          companyId: ctx.companyId,
        })
        return v1ErrorResponseFromCode('INVOICE_SEND_PDF_RENDER_FAILED', ctx.log, {
          requestId: ctx.requestId,
        })
      }
    }

    if (ctx.dryRun) {
      // Dry-run stops here. Validated everything that doesn't have side
      // effects; preview the would-be sent state.
      return dryRunPreview(
        {
          ...typed,
          status: 'sent' as const,
          invoice_number: typed.invoice_number ?? '(allocated atomically on commit)',
          would_send_to: customer.email,
          would_cc: settings.email || null,
          would_create_journal_entry:
            (!typed.document_type || typed.document_type === 'invoice') &&
            (settings.accounting_method ?? 'accrual') === 'accrual',
          accounting_method: settings.accounting_method ?? 'accrual',
          preflight_pdf_render: 'ok',
        },
        { requestId: ctx.requestId, log: ctx.log },
      )
    }

    // Step 6: allocate F-series number atomically.
    try {
      await ensureInvoiceNumber(ctx.supabase, ctx.companyId!, typed as Invoice)
    } catch (err) {
      ctx.log.error('invoices.send: ensureInvoiceNumber failed', err as Error, {
        invoiceId,
        companyId: ctx.companyId,
      })
      return v1ErrorResponseFromCode('INVOICE_SEND_NUMBER_ASSIGN_FAILED', ctx.log, {
        requestId: ctx.requestId,
      })
    }

    // Step 7: final PDF render with the assigned number. typed.invoice_number
    // was mutated by ensureInvoiceNumber. Re-read to be safe.
    const { data: numbered } = await ctx.supabase
      .from('invoices')
      .select('invoice_number')
      .eq('id', invoiceId)
      .eq('company_id', ctx.companyId!)
      .single()
    const finalInvoiceNumber = (numbered as { invoice_number?: string } | null)?.invoice_number
    const renderableInvoice: Invoice = {
      ...(typed as Invoice),
      invoice_number: finalInvoiceNumber ?? typed.invoice_number,
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await renderToBuffer(
        InvoicePDF({
          invoice: renderableInvoice,
          customer,
          items,
          company: settings,
          originalInvoiceNumber,
        }),
      )
    } catch (err) {
      // F-series number IS consumed at this point (orphan window).
      ctx.log.error('invoices.send: final PDF render failed AFTER number allocation', err as Error, {
        invoiceId,
        companyId: ctx.companyId,
        invoiceNumber: finalInvoiceNumber,
      })
      return v1ErrorResponseFromCode('INVOICE_SEND_PDF_RENDER_FAILED', ctx.log, {
        requestId: ctx.requestId,
      })
    }

    // Step 8: send the email. Delivery notes were rejected earlier so
    // docType is 'invoice' or 'proforma' here.
    const isCreditNote = !!typed.credited_invoice_id
    const docType = typed.document_type ?? 'invoice'
    let filename: string
    if (isCreditNote) filename = `kreditfaktura-${finalInvoiceNumber}.pdf`
    else if (docType === 'proforma') filename = `proformafaktura-${finalInvoiceNumber}.pdf`
    else filename = `faktura-${finalInvoiceNumber}.pdf`

    const ccAddress = settings.email ?? null
    const emailData = { invoice: renderableInvoice, customer, company: settings }
    const result = await emailService.sendEmail({
      to: customer.email,
      cc: ccAddress ?? undefined,
      subject: generateInvoiceEmailSubject(emailData),
      html: generateInvoiceEmailHtml(emailData),
      text: generateInvoiceEmailText(emailData),
      replyTo: settings.email ?? undefined,
      fromName: settings.company_name ?? undefined,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    })

    if (!result.success) {
      ctx.log.error('invoices.send: email provider failed', new Error(result.error ?? 'unknown'), {
        invoiceId,
        companyId: ctx.companyId,
      })
      return v1ErrorResponseFromCode('INVOICE_SEND_PROVIDER_FAILED', ctx.log, {
        requestId: ctx.requestId,
      })
    }

    // ── POINT OF NO RETURN ────────────────────────────────────────────
    // Email has been delivered. Subsequent failures surface as warnings.
    const warnings: { code: string; message: string }[] = []

    // Step 9a: status flip to 'sent'.
    const { error: statusErr } = await ctx.supabase
      .from('invoices')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('company_id', ctx.companyId!)
      .eq('status', 'draft')
    if (statusErr) {
      ctx.log.error('invoices.send: status flip failed AFTER email delivery', statusErr as Error, {
        invoiceId,
        companyId: ctx.companyId,
      })
      warnings.push({
        code: 'STATUS_UPDATE_FAILED',
        message: 'Email delivered but the invoice could not be marked as sent. Reconcile manually.',
      })
    }

    // Step 9b: journal entry (accrual + real invoices).
    let journalEntryId: string | null = null
    const isRealInvoice = !typed.document_type || typed.document_type === 'invoice'
    const accountingMethod = settings.accounting_method ?? 'accrual'
    if (isRealInvoice && accountingMethod === 'accrual') {
      try {
        const entry = await createInvoiceJournalEntry(
          ctx.supabase,
          ctx.companyId!,
          ctx.userId,
          renderableInvoice,
          (settings.entity_type ?? 'enskild_firma') as EntityType,
          customer.name,
        )
        if (entry) {
          journalEntryId = entry.id
          const { error: writeBackErr } = await ctx.supabase
            .from('invoices')
            .update({ journal_entry_id: entry.id })
            .eq('id', invoiceId)
            .eq('company_id', ctx.companyId!)
          if (writeBackErr) {
            ctx.log.error('invoices.send: journal_entry_id write-back failed', writeBackErr as Error, {
              invoiceId,
              journalEntryId: entry.id,
            })
            warnings.push({
              code: 'JOURNAL_ENTRY_ID_WRITEBACK_FAILED',
              message: 'Journal entry was posted but the invoice row could not be updated with its id.',
            })
          }
        } else {
          warnings.push({
            code: 'JOURNAL_ENTRY_NOT_POSTED',
            message: 'Invoice was sent but the journal entry was not posted (likely no open fiscal period). Reconcile before period close.',
          })
        }
      } catch (err) {
        ctx.log.error('invoices.send: journal entry creation failed', err as Error, {
          invoiceId,
          companyId: ctx.companyId,
        })
        warnings.push({
          code: 'JOURNAL_ENTRY_NOT_POSTED',
          message: 'Invoice was sent but the journal entry posting failed. Check engine logs; reconcile for BFL 5 kap compliance.',
        })
      }
    }

    // Step 9c: archive the PDF as underlag.
    if (isRealInvoice) {
      try {
        const pdfArrayBuffer = new Uint8Array(pdfBuffer).buffer as ArrayBuffer
        await uploadDocument(
          ctx.supabase,
          ctx.userId,
          ctx.companyId!,
          {
            name: filename,
            buffer: pdfArrayBuffer,
            type: 'application/pdf',
          },
          {
            upload_source: 'system',
            journal_entry_id: journalEntryId ?? undefined,
          },
        )
      } catch (err) {
        ctx.log.error('invoices.send: PDF archival failed', err as Error, {
          invoiceId,
          companyId: ctx.companyId,
        })
        warnings.push({
          code: 'PDF_ARCHIVE_FAILED',
          message: 'Invoice was sent but the PDF could not be archived as underlag. Manual upload required for BFL 7 kap retention.',
        })
      }
    }

    // Step 9d: emit invoice.sent.
    try {
      await eventBus.emit({
        type: 'invoice.sent',
        payload: {
          invoice: renderableInvoice,
          companyId: ctx.companyId!,
          userId: ctx.userId,
        },
      })
    } catch (err) {
      ctx.log.error('invoice.sent emit failed', err as Error, {
        invoiceId,
        companyId: ctx.companyId,
      })
      warnings.push({
        code: 'EVENT_EMIT_FAILED',
        message: 'invoice.sent event did not reach the bus; downstream subscribers may miss this transition.',
      })
    }

    ctx.log.info('invoices.send success', {
      invoiceId,
      companyId: ctx.companyId,
      userId: ctx.userId,
      invoiceNumber: finalInvoiceNumber,
      sentTo: customer.email,
      journalEntryId,
      hadWarnings: warnings.length > 0,
    })

    return ok(
      {
        id: invoiceId,
        invoice_number: finalInvoiceNumber,
        status: 'sent' as const,
        total: typed.total,
        message_id: result.messageId ?? null,
        sent_to: customer.email,
        cc: ccAddress,
        journal_entry_id: journalEntryId,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      { requestId: ctx.requestId },
    )
  },
  { requireIdempotencyKey: true },
)
