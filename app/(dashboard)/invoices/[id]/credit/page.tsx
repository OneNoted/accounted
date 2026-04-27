'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/ui/use-toast'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { getVatTreatmentLabel } from '@/lib/invoices/vat-rules'
import { Loader2, ArrowLeft, AlertTriangle, Lock } from 'lucide-react'
import { useCanWrite } from '@/lib/hooks/use-can-write'
import type { Invoice, InvoiceItem, Customer } from '@/types'

interface InvoiceWithRelations extends Invoice {
  customer: Customer
  items: InvoiceItem[]
}

export default function CreateCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { canWrite } = useCanWrite()
  const { id } = use(params)
  const router = useRouter()
  const { toast } = useToast()
  const supabase = createClient()

  const [invoice, setInvoice] = useState<InvoiceWithRelations | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    fetchInvoice()
  }, [id])

  async function fetchInvoice() {
    setIsLoading(true)

    const { data, error } = await supabase
      .from('invoices')
      .select(`
        *,
        customer:customers(*),
        items:invoice_items(*)
      `)
      .eq('id', id)
      .single()

    if (error || !data) {
      toast({
        title: 'Kunde inte ladda faktura',
        description: 'Fakturan hittades inte.',
        variant: 'destructive',
      })
      router.push('/invoices')
      return
    }

    // Check if invoice can be credited
    if (!['sent', 'paid', 'overdue'].includes(data.status)) {
      toast({
        title: 'Kan inte krediteras',
        description: 'Endast skickade, betalda eller förfallna fakturor kan krediteras',
        variant: 'destructive',
      })
      router.push(`/invoices/${id}`)
      return
    }

    if (data.status === 'credited') {
      toast({
        title: 'Redan krediterad',
        description: 'Denna faktura har redan krediterats',
        variant: 'destructive',
      })
      router.push(`/invoices/${id}`)
      return
    }

    // Sort items by sort_order
    if (data.items) {
      data.items.sort((a: InvoiceItem, b: InvoiceItem) => a.sort_order - b.sort_order)
    }

    setInvoice(data as InvoiceWithRelations)
    setReason(`Krediterar faktura ${data.invoice_number}`)
    setIsLoading(false)
  }

  async function handleSubmit() {
    if (!invoice) return

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credited_invoice_id: invoice.id,
          reason,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create credit note')
      }

      const { data: creditNote } = await response.json()

      toast({
        title: 'Kreditfaktura skapad',
        description: `Kreditfaktura ${creditNote.invoice_number} har skapats`,
      })

      router.push(`/invoices/${creditNote.id}`)
    } catch (error) {
      toast({
        title: 'Kunde inte skapa kreditfaktura',
        description: error instanceof Error ? error.message : 'Försök igen.',
        variant: 'destructive',
      })
    }

    setIsSubmitting(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!invoice) {
    return null
  }

  const customer = invoice.customer

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-medium tracking-tight">Skapa kreditfaktura</h1>
          <p className="text-muted-foreground">
            Krediterar faktura {invoice.invoice_number}
          </p>
        </div>
      </div>

      {/* Warning */}
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="flex items-start gap-4 pt-6">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Oåterkallelig åtgärd</p>
            <p className="text-sm text-muted-foreground mt-1">
              En kreditfaktura makulerar den ursprungliga fakturan helt.
              Alla belopp blir negativa, en bokföringsverifikation skapas, och den ursprungliga fakturan markeras som krediterad.
              Denna åtgärd kan inte ångras.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Original invoice info */}
      <Card>
        <CardHeader>
          <CardTitle>Ursprunglig faktura</CardTitle>
          <CardDescription>
            Kreditfakturan baseras på denna faktura
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Fakturanummer:</span>
              <span className="ml-2 font-medium">{invoice.invoice_number}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Datum:</span>
              <span className="ml-2">{formatDate(invoice.invoice_date)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Kund:</span>
              <span className="ml-2">{customer.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Momsbehandling:</span>
              <span className="ml-2">{getVatTreatmentLabel(invoice.vat_treatment)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Credit note preview */}
      <Card>
        <CardHeader>
          <CardTitle>Kreditfaktura förhandsgranskning</CardTitle>
          <CardDescription>
            Kreditfakturanummer: KR-{invoice.invoice_number}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground border-b pb-2">
              <div className="col-span-5">Beskrivning</div>
              <div className="col-span-2 text-right">Antal</div>
              <div className="col-span-1 text-center">Enhet</div>
              <div className="col-span-2 text-right">à-pris</div>
              <div className="col-span-2 text-right">Summa</div>
            </div>

            {/* Items (negated) */}
            {invoice.items.map((item) => (
              <div key={item.id} className="grid grid-cols-12 gap-4 text-sm">
                <div className="col-span-5">{item.description}</div>
                <div className="col-span-2 text-right text-destructive">
                  -{Math.abs(item.quantity)}
                </div>
                <div className="col-span-1 text-center">{item.unit}</div>
                <div className="col-span-2 text-right">
                  {formatCurrency(item.unit_price, invoice.currency)}
                </div>
                <div className="col-span-2 text-right font-medium text-destructive">
                  {formatCurrency(-Math.abs(item.line_total), invoice.currency)}
                </div>
              </div>
            ))}

            <Separator />

            {/* Totals (negated) */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delsumma</span>
                <span className="text-destructive">
                  {formatCurrency(-Math.abs(invoice.subtotal), invoice.currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Moms ({invoice.vat_rate}%)</span>
                <span className="text-destructive">
                  {formatCurrency(-Math.abs(invoice.vat_amount), invoice.currency)}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Totalt</span>
                <span className="text-destructive">
                  {formatCurrency(-Math.abs(invoice.total), invoice.currency)}
                </span>
              </div>
              {invoice.currency !== 'SEK' && invoice.total_sek && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>I SEK (kurs {invoice.exchange_rate})</span>
                  <span className="text-destructive">
                    {formatCurrency(-Math.abs(invoice.total_sek))}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reason */}
      <Card>
        <CardHeader>
          <CardTitle>Anledning</CardTitle>
          <CardDescription>
            Ange anledning till kreditering (visas på kreditfakturan)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="reason">Anledning</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="T.ex. Felaktig fakturering, returnerade varor..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Confirmation */}
      <Card>
        <CardHeader>
          <CardTitle>Bekräfta</CardTitle>
          <CardDescription>
            Skriv fakturanumret <span className="font-mono font-semibold text-foreground">{invoice.invoice_number}</span> för att bekräfta
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={invoice.invoice_number ?? ''}
            disabled={!invoice.invoice_number}
            className={cn(
              confirmText && confirmText !== invoice.invoice_number && 'border-destructive'
            )}
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-4">
        <Button variant="outline" onClick={() => router.back()}>
          Avbryt
        </Button>
        <Button
          variant="destructive"
          onClick={handleSubmit}
          disabled={
            isSubmitting ||
            !invoice.invoice_number ||
            confirmText !== invoice.invoice_number ||
            !canWrite
          }
          title={!canWrite ? 'Du har endast läsbehörighet i detta företag' : undefined}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Skapar...
            </>
          ) : !canWrite ? (
            <>
              <Lock className="mr-2 h-4 w-4" />
              Skapa kreditfaktura
            </>
          ) : (
            'Skapa kreditfaktura'
          )}
        </Button>
      </div>
    </div>
  )
}
