import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { eventBus } from '@/lib/events'
import { ensureInitialized } from '@/lib/init'
import { CreateInvoiceSchema, CreateCreditNoteSchema } from '@/lib/api/schemas'
import type { EntityType, AccountingMethod, Invoice, CreditNote, InvoiceDocumentType } from '@/types'
import { getVatRules, getAvailableVatRates } from '@/lib/invoices/vat-rules'
import { fetchExchangeRate, convertToSEK } from '@/lib/currency/riksbanken'
import {
  createCreditNoteJournalEntry,
} from '@/lib/bookkeeping/invoice-entries'
import { requireCompanyId } from '@/lib/company/context'
import { requireWritePermission } from '@/lib/auth/require-write'

ensureInitialized()

export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const companyId = await requireCompanyId(supabase, user.id)

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  let query = supabase
    .from('invoices')
    .select('*, customer:customers(*)', { count: 'exact' })
    .eq('company_id', companyId)
    .order('invoice_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data, count })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const writeCheck = await requireWritePermission(supabase, user.id)
  if (!writeCheck.ok) return writeCheck.response

  const companyId = await requireCompanyId(supabase, user.id)

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON in request body', type: 'validation_error' },
      { status: 400 },
    )
  }

  // Check if this is a credit note creation request
  if (typeof rawBody === 'object' && rawBody !== null && 'credited_invoice_id' in rawBody) {
    const parsed = CreateCreditNoteSchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          type: 'validation_error',
          errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message, code: i.code })),
        },
        { status: 400 },
      )
    }
    return createCreditNote(supabase, companyId, user.id, parsed.data)
  }

  const parsed = CreateInvoiceSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        type: 'validation_error',
        errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message, code: i.code })),
      },
      { status: 400 },
    )
  }
  const invoiceInput = parsed.data
  const documentType: InvoiceDocumentType = invoiceInput.document_type || 'invoice'

  // Get customer for VAT calculation
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('*')
    .eq('id', invoiceInput.customer_id)
    .eq('company_id', companyId)
    .single()

  if (customerError || !customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  // Calculate VAT rules (default for customer)
  const vatRules = getVatRules(customer.customer_type, customer.vat_number_validated)
  const availableRates = getAvailableVatRates(customer.customer_type, customer.vat_number_validated)
  const allowedRates = new Set(availableRates.map((r) => r.rate))

  // Calculate per-item VAT and subtotals
  const subtotal = invoiceInput.items.reduce((sum, item) => {
    return sum + item.quantity * item.unit_price
  }, 0)

  // Calculate VAT per item, respecting per-line vat_rate
  let vatAmount = 0
  if (documentType !== 'delivery_note') {
    for (const item of invoiceInput.items) {
      const itemRate = item.vat_rate !== undefined ? item.vat_rate : vatRules.rate
      // Validate rate is allowed for this customer
      if (!allowedRates.has(itemRate)) {
        return NextResponse.json(
          { error: `Momssats ${itemRate}% är inte tillåten för denna kundtyp` },
          { status: 400 }
        )
      }
      const lineTotal = item.quantity * item.unit_price
      vatAmount += Math.round(lineTotal * itemRate / 100 * 100) / 100
    }
  }
  const total = documentType === 'delivery_note' ? 0 : subtotal + vatAmount

  // Determine if this is a mixed-rate invoice
  const uniqueRates = new Set(invoiceInput.items.map((item) => item.vat_rate ?? vatRules.rate))
  const isMixedRate = uniqueRates.size > 1

  // Handle currency conversion
  let exchangeRate: number | null = null
  let exchangeRateDate: string | null = null
  let subtotalSek: number | null = null
  let vatAmountSek: number | null = null
  let totalSek: number | null = null

  if (invoiceInput.currency !== 'SEK') {
    const rateData = await fetchExchangeRate(invoiceInput.currency)
    if (rateData) {
      exchangeRate = rateData.rate
      exchangeRateDate = rateData.date
      subtotalSek = convertToSEK(subtotal, exchangeRate)
      vatAmountSek = convertToSEK(vatAmount, exchangeRate)
      totalSek = convertToSEK(total, exchangeRate)
    }
  }

  // Generate document number — eagerly for delivery notes (separate sequence,
  // separate UX), lazily for invoices and proformas (assigned at first send so
  // discarded drafts never consume a number).
  let invoiceNumber: string | null = null
  if (documentType === 'delivery_note') {
    const { data: dnNumber } = await supabase.rpc('generate_delivery_note_number', {
      p_company_id: companyId,
    })
    invoiceNumber = dnNumber
  }

  // Create invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      user_id: user.id,
      company_id: companyId,
      customer_id: invoiceInput.customer_id,
      invoice_number: invoiceNumber,
      invoice_date: invoiceInput.invoice_date,
      due_date: invoiceInput.due_date,
      delivery_date: invoiceInput.delivery_date ?? null,
      currency: invoiceInput.currency,
      exchange_rate: exchangeRate,
      exchange_rate_date: exchangeRateDate,
      subtotal: documentType === 'delivery_note' ? 0 : subtotal,
      subtotal_sek: documentType === 'delivery_note' ? null : subtotalSek,
      vat_amount: vatAmount,
      vat_amount_sek: documentType === 'delivery_note' ? null : vatAmountSek,
      total,
      total_sek: documentType === 'delivery_note' ? null : totalSek,
      vat_treatment: vatRules.treatment,
      vat_rate: documentType === 'delivery_note' ? 0 : (isMixedRate ? null : (uniqueRates.values().next().value ?? vatRules.rate)),
      moms_ruta: vatRules.momsRuta,
      reverse_charge_text: vatRules.reverseChargeText || null,
      your_reference: invoiceInput.your_reference,
      our_reference: invoiceInput.our_reference,
      notes: invoiceInput.notes,
      document_type: documentType,
    })
    .select()
    .single()

  if (invoiceError) {
    console.error('Invoice insert error:', invoiceError)
    return NextResponse.json({ error: invoiceError.message }, { status: 500 })
  }

  // Create invoice items with per-line VAT
  const items = invoiceInput.items.map((item, index) => {
    const itemRate = item.vat_rate !== undefined ? item.vat_rate : vatRules.rate
    const lineTotal = item.quantity * item.unit_price
    const itemVat = documentType === 'delivery_note' ? 0 : Math.round(lineTotal * itemRate / 100 * 100) / 100
    return {
      invoice_id: invoice.id,
      sort_order: index,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      line_total: lineTotal,
      vat_rate: itemRate,
      vat_amount: itemVat,
    }
  })

  const { error: itemsError } = await supabase
    .from('invoice_items')
    .insert(items)

  if (itemsError) {
    // Rollback invoice creation
    await supabase.from('invoices').delete().eq('id', invoice.id)
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  // Fetch complete invoice with items
  const { data: completeInvoice } = await supabase
    .from('invoices')
    .select('*, customer:customers(*), items:invoice_items(*)')
    .eq('id', invoice.id)
    .single()

  // Emit event only for real invoices (proformas and delivery notes are informational)
  if (completeInvoice && documentType === 'invoice') {
    await eventBus.emit({
      type: 'invoice.created',
      payload: { invoice: completeInvoice as Invoice, companyId, userId: user.id },
    })
  }

  return NextResponse.json({ data: completeInvoice })
}

// Create a credit note for an existing invoice
async function createCreditNote(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  userId: string,
  input: { credited_invoice_id: string; reason?: string }
) {
  // Fetch the original invoice with items
  const { data: originalInvoice, error: originalError } = await supabase
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .eq('id', input.credited_invoice_id)
    .eq('company_id', companyId)
    .single()

  if (originalError || !originalInvoice) {
    return NextResponse.json({ error: 'Original invoice not found' }, { status: 404 })
  }

  // Credit notes can only be created from real invoices
  if (originalInvoice.document_type && originalInvoice.document_type !== 'invoice') {
    return NextResponse.json(
      { error: 'Credit notes can only be created from standard invoices' },
      { status: 400 }
    )
  }

  // Check if invoice is already credited
  if (originalInvoice.status === 'credited') {
    return NextResponse.json({ error: 'Invoice has already been credited' }, { status: 400 })
  }

  // Check if invoice can be credited (only sent, paid, or overdue invoices can be credited)
  if (!['sent', 'paid', 'overdue'].includes(originalInvoice.status)) {
    return NextResponse.json(
      { error: 'Only sent, paid, or overdue invoices can be credited' },
      { status: 400 }
    )
  }

  // Generate credit note number
  const creditNoteNumber = `KR-${originalInvoice.invoice_number}`

  // Create the credit note with negated amounts
  const { data: creditNote, error: creditNoteError } = await supabase
    .from('invoices')
    .insert({
      user_id: userId,
      company_id: companyId,
      customer_id: originalInvoice.customer_id,
      invoice_number: creditNoteNumber,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: new Date().toISOString().split('T')[0],
      delivery_date: originalInvoice.delivery_date ?? null,
      currency: originalInvoice.currency,
      exchange_rate: originalInvoice.exchange_rate,
      exchange_rate_date: originalInvoice.exchange_rate_date,
      // Negate all amounts
      subtotal: -Math.abs(originalInvoice.subtotal),
      subtotal_sek: originalInvoice.subtotal_sek ? -Math.abs(originalInvoice.subtotal_sek) : null,
      vat_amount: -Math.abs(originalInvoice.vat_amount),
      vat_amount_sek: originalInvoice.vat_amount_sek ? -Math.abs(originalInvoice.vat_amount_sek) : null,
      total: -Math.abs(originalInvoice.total),
      total_sek: originalInvoice.total_sek ? -Math.abs(originalInvoice.total_sek) : null,
      // Same VAT treatment as original
      vat_treatment: originalInvoice.vat_treatment,
      vat_rate: originalInvoice.vat_rate,
      moms_ruta: originalInvoice.moms_ruta,
      reverse_charge_text: originalInvoice.reverse_charge_text,
      // References
      your_reference: originalInvoice.your_reference,
      our_reference: originalInvoice.our_reference,
      notes: input.reason || `Krediterar faktura ${originalInvoice.invoice_number}`,
      credited_invoice_id: input.credited_invoice_id,
      status: 'sent', // Credit notes are immediately "sent"
    })
    .select()
    .single()

  if (creditNoteError) {
    return NextResponse.json({ error: creditNoteError.message }, { status: 500 })
  }

  // Create credit note items (negated from original, preserving per-line VAT)
  const creditNoteItems = (originalInvoice.items || []).map((item: { sort_order: number; description: string; quantity: number; unit: string; unit_price: number; line_total: number; vat_rate?: number; vat_amount?: number }) => ({
    invoice_id: creditNote.id,
    sort_order: item.sort_order,
    description: item.description,
    quantity: -Math.abs(item.quantity),
    unit: item.unit,
    unit_price: item.unit_price,
    line_total: -Math.abs(item.line_total),
    vat_rate: item.vat_rate ?? 0,
    vat_amount: -(item.vat_amount ? Math.abs(item.vat_amount) : 0),
  }))

  const { error: itemsError } = await supabase
    .from('invoice_items')
    .insert(creditNoteItems)

  if (itemsError) {
    // Rollback credit note creation
    await supabase.from('invoices').delete().eq('id', creditNote.id)
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  // Update original invoice status to 'credited'
  await supabase
    .from('invoices')
    .update({ status: 'credited' })
    .eq('id', input.credited_invoice_id)

  // Fetch complete credit note with items
  const { data: completeCreditNote } = await supabase
    .from('invoices')
    .select('*, customer:customers(*), items:invoice_items(*)')
    .eq('id', creditNote.id)
    .single()

  // Fetch entity type and accounting method for correct account mapping
  const { data: creditNoteSettings } = await supabase
    .from('company_settings')
    .select('entity_type, accounting_method')
    .eq('company_id', companyId)
    .single()

  const entityType = (creditNoteSettings?.entity_type as EntityType) || 'enskild_firma'
  const accountingMethod = (creditNoteSettings?.accounting_method as AccountingMethod) || 'accrual'

  // Create journal entry for the credit note (non-blocking)
  // Cash method: skip — no original invoice entry exists to reverse; deferred until refund
  if (completeCreditNote && accountingMethod === 'accrual') {
    try {
      const journalEntry = await createCreditNoteJournalEntry(
        supabase,
        companyId,
        userId,
        completeCreditNote as Invoice,
        entityType,
        completeCreditNote.customer?.name
      )
      if (journalEntry) {
        await supabase
          .from('invoices')
          .update({ journal_entry_id: journalEntry.id })
          .eq('id', creditNote.id)
      }
    } catch (err) {
      console.error('Failed to create credit note journal entry:', err)
    }

    await eventBus.emit({
      type: 'credit_note.created',
      payload: { creditNote: completeCreditNote as CreditNote, companyId, userId },
    })
  }

  return NextResponse.json({ data: completeCreditNote })
}
