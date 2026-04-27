import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { eventBus } from '@/lib/events'
import { ensureInitialized } from '@/lib/init'
import { renderToBuffer } from '@react-pdf/renderer'
import { InvoicePDF } from '@/lib/invoices/pdf-template'
import { getEmailService } from '@/lib/email/service'
import {
  generateInvoiceEmailHtml,
  generateInvoiceEmailText,
  generateInvoiceEmailSubject
} from '@/lib/email/invoice-templates'
import { createInvoiceJournalEntry } from '@/lib/bookkeeping/invoice-entries'
import { uploadDocument } from '@/lib/core/documents/document-service'
import { ensureInvoiceNumber } from '@/lib/invoices/ensure-invoice-number'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'
import type { Invoice, InvoiceItem, Customer, CompanySettings } from '@/types'

ensureInitialized()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
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

  // Check if email is configured
  const emailService = getEmailService()
  if (!emailService.isConfigured()) {
    return NextResponse.json(
      { error: 'E-posttjänsten är inte konfigurerad. Kontrollera att RESEND_API_KEY och RESEND_FROM_EMAIL är satta i miljövariablerna.' },
      { status: 503 }
    )
  }

  // Fetch invoice with customer and items
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select(`
      *,
      customer:customers(*),
      items:invoice_items(*)
    `)
    .eq('id', id)
    .eq('company_id', companyId)
    .single()

  if (invoiceError || !invoice) {
    return NextResponse.json({ error: 'Fakturan hittades inte' }, { status: 404 })
  }

  // Verify customer has email
  const customer = invoice.customer as Customer
  if (!customer.email) {
    return NextResponse.json(
      { error: 'Kunden saknar e-postadress. Uppdatera kunduppgifterna först.' },
      { status: 400 }
    )
  }

  // Fetch company settings
  const { data: company, error: companyError } = await supabase
    .from('company_settings')
    .select('*')
    .eq('company_id', companyId)
    .single()

  if (companyError || !company) {
    return NextResponse.json(
      { error: 'Företagsinställningar saknas' },
      { status: 404 }
    )
  }

  // Assign invoice number now if this is a draft being sent for the first time.
  // Mutates `invoice.invoice_number` so the rest of this flow (PDF render,
  // email subject, journal entry description) sees the new value.
  try {
    await ensureInvoiceNumber(supabase, companyId, invoice as Invoice)
  } catch (err) {
    console.error('Failed to assign invoice number on send:', err)
    return NextResponse.json(
      { error: 'Kunde inte tilldela fakturanummer. Försök igen.' },
      { status: 500 }
    )
  }

  // Sort items by sort_order
  const items = (invoice.items as InvoiceItem[]).sort(
    (a, b) => a.sort_order - b.sort_order
  )

  // If this is a credit note, fetch the original invoice number
  let originalInvoiceNumber: string | undefined
  if (invoice.credited_invoice_id) {
    const { data: originalInvoice } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('id', invoice.credited_invoice_id)
      .single()

    if (originalInvoice) {
      originalInvoiceNumber = originalInvoice.invoice_number
    }
  }

  try {
    // Generate PDF
    const pdfBuffer = await renderToBuffer(
      InvoicePDF({
        invoice: invoice as Invoice,
        customer,
        items,
        company: company as CompanySettings,
        originalInvoiceNumber,
      })
    )

    // Prepare email data
    const emailData = {
      invoice: invoice as Invoice,
      customer,
      company: company as CompanySettings
    }

    // Determine filename based on document type
    const isCreditNote = !!invoice.credited_invoice_id
    const docType = invoice.document_type || 'invoice'
    let filename: string
    if (isCreditNote) {
      filename = `kreditfaktura-${invoice.invoice_number}.pdf`
    } else if (docType === 'proforma') {
      filename = `proformafaktura-${invoice.invoice_number}.pdf`
    } else if (docType === 'delivery_note') {
      filename = `foljesedel-${invoice.invoice_number}.pdf`
    } else {
      filename = `faktura-${invoice.invoice_number}.pdf`
    }

    // Send email (CC the user so they have a copy of what was sent)
    const ccAddress = company.email || user.email
    const result = await emailService.sendEmail({
      to: customer.email,
      cc: ccAddress,
      subject: generateInvoiceEmailSubject(emailData),
      html: generateInvoiceEmailHtml(emailData),
      text: generateInvoiceEmailText(emailData),
      replyTo: company.email || undefined,
      fromName: company.trade_name || company.company_name,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    })

    if (!result.success) {
      console.error('Failed to send invoice email:', result.error)
      return NextResponse.json(
        { error: `Kunde inte skicka e-post: ${result.error}` },
        { status: 500 }
      )
    }

    // Update invoice status to "sent"
    const { error: updateError } = await supabase
      .from('invoices')
      .update({ status: 'sent' })
      .eq('id', id)
      .eq('company_id', companyId)

    if (updateError) {
      console.error('Failed to update invoice status:', updateError)
      // Don't fail the request - the email was sent successfully
    }

    // Only create journal entries for real invoices (not proformas or delivery notes)
    const isRealInvoice = !invoice.document_type || invoice.document_type === 'invoice'
    let createdJournalEntryId: string | undefined
    if (isRealInvoice && ((company as Record<string, unknown>).accounting_method === 'accrual' || !(company as Record<string, unknown>).accounting_method)) {
      try {
        const journalEntry = await createInvoiceJournalEntry(
          supabase,
          companyId,
          user.id,
          invoice as Invoice,
          (company as CompanySettings).entity_type
        )
        if (journalEntry) {
          createdJournalEntryId = journalEntry.id
          await supabase
            .from('invoices')
            .update({ journal_entry_id: journalEntry.id })
            .eq('id', id)
        }
      } catch (err) {
        console.error('Failed to create invoice journal entry on send:', err)
        // Non-blocking — don't fail the send
      }
    }

    // Auto-store invoice PDF as underlag and link to journal entry
    if (isRealInvoice) {
      try {
        const pdfArrayBuffer = new Uint8Array(pdfBuffer).buffer as ArrayBuffer
        await uploadDocument(supabase, user.id, companyId, {
          name: filename,
          buffer: pdfArrayBuffer,
          type: 'application/pdf',
        }, {
          upload_source: 'system',
          journal_entry_id: createdJournalEntryId,
        })
      } catch (err) {
        console.error('Failed to store invoice PDF as underlag:', err)
        // Non-blocking — don't fail the send
      }
    }

    await eventBus.emit({
      type: 'invoice.sent',
      payload: { invoice: invoice as Invoice, companyId, userId: user.id },
    })

    return NextResponse.json({
      success: true,
      message: `Fakturan har skickats till ${customer.email} (kopia till ${ccAddress})`,
      messageId: result.messageId
    })
  } catch (error) {
    console.error('Send invoice error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Kunde inte skicka fakturan' },
      { status: 500 }
    )
  }
}
