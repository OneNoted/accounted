'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { JournalEntryReviewContent } from '@/components/bookkeeping/JournalEntryReviewContent'
import { proposeSendLines } from '@/lib/bookkeeping/propose-send-lines'
import { formatCurrency } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/contexts/CompanyContext'
import { Loader2, Mail, Send } from 'lucide-react'
import type { Invoice, InvoiceItem, Customer, EntityType } from '@/types'

interface InvoiceWithRelations extends Invoice {
  customer: Customer
  items: InvoiceItem[]
}

interface SendInvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoiceWithRelations
  /** 'email' sends via email, 'manual' marks as sent without email */
  mode: 'email' | 'manual'
  onSuccess: () => void
}

export default function SendInvoiceDialog({
  open,
  onOpenChange,
  invoice,
  mode,
  onSuccess,
}: SendInvoiceDialogProps) {
  const { toast } = useToast()
  const supabase = createClient()
  const { company } = useCompany()

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [accountingMethod, setAccountingMethod] = useState<'accrual' | 'cash'>('accrual')
  const [entityType, setEntityType] = useState<EntityType>('enskild_firma')
  const [periodName, setPeriodName] = useState('')
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    if (!open) {
      setIsInitialized(false)
      return
    }

    let cancelled = false

    async function init() {
      try {
        if (!company?.id) throw new Error('Inget aktivt företag')

        // Fetch company settings
        const { data: settings, error } = await supabase
          .from('company_settings')
          .select('accounting_method, entity_type')
          .eq('company_id', company.id)
          .maybeSingle()

        if (error) throw new Error('Kunde inte ladda företagsinställningar')
        if (cancelled) return

        // Fetch fiscal period for the invoice date
        const { data: period } = await supabase
          .from('fiscal_periods')
          .select('name')
          .eq('company_id', company.id)
          .lte('start_date', invoice.invoice_date)
          .gte('end_date', invoice.invoice_date)
          .maybeSingle()

        if (cancelled) return

        setAccountingMethod((settings?.accounting_method || 'accrual') as 'accrual' | 'cash')
        setEntityType((settings?.entity_type as EntityType) || 'enskild_firma')
        setPeriodName(period?.name || '')
        setIsInitialized(true)
      } catch (err) {
        if (cancelled) return
        toast({
          title: 'Kunde inte ladda inställningar',
          description: err instanceof Error ? err.message : 'Försök igen.',
          variant: 'destructive',
        })
        onOpenChange(false)
      }
    }

    init()
    return () => { cancelled = true }
  }, [open, invoice.id, invoice.invoice_date, company?.id])

  const proposedLines = useMemo(() => {
    if (!isInitialized || accountingMethod !== 'accrual') return []

    return proposeSendLines({
      invoice: {
        invoice_number: invoice.invoice_number,
        total: invoice.total,
        total_sek: invoice.total_sek,
        subtotal: invoice.subtotal,
        subtotal_sek: invoice.subtotal_sek,
        vat_amount: invoice.vat_amount,
        vat_amount_sek: invoice.vat_amount_sek,
        currency: invoice.currency,
        exchange_rate: invoice.exchange_rate,
        vat_treatment: invoice.vat_treatment,
        items: invoice.items,
      },
      entityType,
    })
  }, [isInitialized, accountingMethod, entityType, invoice])

  const { totalDebit, totalCredit } = useMemo(() => {
    let totalDebit = 0
    let totalCredit = 0
    for (const line of proposedLines) {
      totalDebit += parseFloat(line.debit_amount) || 0
      totalCredit += parseFloat(line.credit_amount) || 0
    }
    return { totalDebit, totalCredit }
  }, [proposedLines])

  const handleConfirm = async () => {
    setIsSubmitting(true)

    try {
      const url = mode === 'email'
        ? `/api/invoices/${invoice.id}/send`
        : `/api/invoices/${invoice.id}/mark-sent`

      const response = await fetch(url, { method: 'POST' })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Kunde inte skicka fakturan')
      }

      onSuccess()

      if (mode === 'email') {
        onOpenChange(false)
        toast({
          title: 'Faktura skickad',
          description: data.message || `Fakturan har skickats till ${invoice.customer.email}`,
        })
      } else {
        // For manual send, just close — no email to confirm
        onOpenChange(false)
        toast({
          title: 'Faktura markerad som skickad',
          description: accountingMethod === 'accrual'
            ? 'Bokföringsverifikationen har skapats.'
            : undefined,
        })
      }
    } catch (error) {
      toast({
        title: 'Kunde inte skicka faktura',
        description: error instanceof Error ? error.message : 'Försök igen.',
        variant: 'destructive',
      })
    }

    setIsSubmitting(false)
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  const showJournalPreview = accountingMethod === 'accrual' && proposedLines.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'email' ? 'Skicka faktura' : 'Markera som skickad'}{invoice.invoice_number ? ` — ${invoice.invoice_number}` : ''}
          </DialogTitle>
          <DialogDescription>
            {formatCurrency(invoice.total, invoice.currency)}
            {invoice.currency !== 'SEK' && invoice.total_sek && (
              <> ({formatCurrency(invoice.total_sek)} SEK)</>
            )}
            {mode === 'email' && invoice.customer.email && (
              <> till {invoice.customer.email}</>
            )}
          </DialogDescription>
        </DialogHeader>

        {!isInitialized ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {showJournalPreview ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Följande bokföringsverifikation skapas automatiskt:
                </p>
                <JournalEntryReviewContent
                  periodName={periodName}
                  entryDate={invoice.invoice_date}
                  description={`Försäljning faktura${invoice.invoice_number ? ` ${invoice.invoice_number}` : ''}${invoice.customer.name ? `, ${invoice.customer.name}` : ''}`}
                  lines={proposedLines}
                  totalDebit={totalDebit}
                  totalCredit={totalCredit}
                  showBalanceBadge={true}
                  hideDate={!periodName}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {accountingMethod === 'cash'
                  ? 'Kontantmetoden — bokföring sker vid betalning, inte vid fakturering.'
                  : mode === 'email'
                    ? `Fakturan skickas till ${invoice.customer.email}.`
                    : 'Fakturan markeras som skickad.'}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
            className="w-full sm:w-auto min-h-11"
          >
            Avbryt
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting || !isInitialized}
            className="w-full sm:w-auto min-h-11"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : mode === 'email' ? (
              <Mail className="mr-2 h-4 w-4" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            {mode === 'email' ? 'Skicka faktura' : 'Markera som skickad'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
