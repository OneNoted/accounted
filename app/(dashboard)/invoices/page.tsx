'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/ui/page-header'
import {
  DataList,
  DataListRow,
  DataListPrimary,
  DataListMeta,
  DataListMetaSeparator,
  DataListEmpty,
} from '@/components/ui/data-list'
import { useToast } from '@/components/ui/use-toast'
import { formatCurrency, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { invoiceNumberDisplay } from '@/lib/invoices/display'
import { getDisplayTotal } from '@/lib/invoices/rounding'
import { Plus, Search, Receipt, Lock, Repeat } from 'lucide-react'
import { EmptyInvoices } from '@/components/ui/empty-state'
import { useCompany } from '@/contexts/CompanyContext'
import { useCanWrite } from '@/lib/hooks/use-can-write'
import type { Invoice, InvoiceStatus } from '@/types'

const statusConfig: Record<InvoiceStatus, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  draft: { label: 'Utkast', variant: 'secondary' },
  sent: { label: 'Skickad', variant: 'default' },
  paid: { label: 'Betald', variant: 'success' },
  partially_paid: { label: 'Delbetalad', variant: 'warning' },
  overdue: { label: 'Förfallen', variant: 'destructive' },
  cancelled: { label: 'Makulerad', variant: 'secondary' },
  credited: { label: 'Krediterad', variant: 'secondary' },
}

function getRelativeTimeLabel(dueDateStr: string, status: InvoiceStatus): { text: string; color: string } | null {
  if (status === 'paid' || status === 'cancelled' || status === 'credited' || status === 'draft') return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(dueDateStr)
  dueDate.setHours(0, 0, 0, 0)
  const diffDays = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return { text: `${Math.abs(diffDays)} dagar försenad`, color: 'text-destructive' }
  } else if (diffDays === 0) {
    return { text: 'Förfaller idag', color: 'text-warning-foreground' }
  } else if (diffDays <= 3) {
    return { text: `${diffDays} dagar kvar`, color: 'text-warning-foreground' }
  } else if (diffDays <= 7) {
    return { text: `${diffDays} dagar kvar`, color: 'text-muted-foreground' }
  }
  return null
}

export default function InvoicesPage() {
  const { company } = useCompany()
  const { canWrite } = useCanWrite()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [oreRounding, setOreRounding] = useState<boolean>(true)
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const { toast } = useToast()
  const supabase = createClient()

  async function fetchInvoices() {
    if (!company) return
    setIsLoading(true)
    const [invoicesResult, settingsResult] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, customer:customers(name)')
        .eq('company_id', company.id)
        .order('invoice_date', { ascending: false }),
      supabase
        .from('company_settings')
        .select('ore_rounding')
        .eq('company_id', company.id)
        .maybeSingle(),
    ])

    if (invoicesResult.error) {
      toast({
        title: 'Kunde inte ladda fakturor',
        description: 'Kontrollera din anslutning och försök igen.',
        variant: 'destructive',
      })
    } else {
      setInvoices(invoicesResult.data || [])
    }
    setOreRounding(settingsResult.data?.ore_rounding ?? true)
    setIsLoading(false)
  }

  useEffect(() => {
    fetchInvoices()
  }, [])

  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch =
      (invoice.invoice_number ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (invoice.customer as { name: string })?.name?.toLowerCase().includes(searchTerm.toLowerCase())

    const isCreditNote = !!invoice.credited_invoice_id
    const docType = (invoice as Invoice & { document_type?: string }).document_type || 'invoice'
    // Cancelled invoices are kept in the table for compliance but hidden from
    // the default 'Alla' view; they only show up when the user explicitly picks
    // the 'Makulerade' tab.
    const matchesTab =
      (activeTab === 'all' && invoice.status !== 'cancelled') ||
      (activeTab === 'unpaid' && ['sent', 'overdue'].includes(invoice.status) && !isCreditNote && docType === 'invoice') ||
      (activeTab === 'credit' && isCreditNote) ||
      (activeTab === 'proforma' && docType === 'proforma' && invoice.status !== 'cancelled') ||
      (activeTab === 'delivery_note' && docType === 'delivery_note' && invoice.status !== 'cancelled') ||
      (activeTab === 'cancelled' && invoice.status === 'cancelled') ||
      (activeTab !== 'all' && activeTab !== 'proforma' && activeTab !== 'delivery_note' && activeTab !== 'cancelled' && invoice.status === activeTab)

    return matchesSearch && matchesTab
  })

  const isOutstandingReceivable = (i: Invoice) =>
    ['sent', 'overdue'].includes(i.status) && !i.credited_invoice_id
  const stats = {
    unpaid: invoices.filter(isOutstandingReceivable).length,
    unpaidAmount: invoices
      .filter(isOutstandingReceivable)
      .reduce((sum, i) => {
        if (i.currency === 'SEK') {
          return sum + getDisplayTotal({ total: Number(i.total), currency: 'SEK' }, { ore_rounding: oreRounding }).displayed
        }
        return sum + Number(i.total_sek || i.total)
      }, 0),
    overdue: invoices.filter((i) => i.status === 'overdue' && !i.credited_invoice_id).length,
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Fakturor"
        action={
          <div className="flex gap-2">
            <Link href="/invoices/recurring">
              <Button variant="secondary">
                <Repeat className="mr-2 h-4 w-4" />
                Återkommande
              </Button>
            </Link>
            {canWrite ? (
              <Link href="/invoices/new">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Ny faktura
                </Button>
              </Link>
            ) : (
              <Button
                disabled
                title="Du har endast läsbehörighet i detta företag"
              >
                <Lock className="mr-2 h-4 w-4" />
                Ny faktura
              </Button>
            )}
          </div>
        }
      />

      {/* Inline summary */}
      {!isLoading && invoices.length > 0 && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {invoices.length} {invoices.length === 1 ? 'faktura' : 'fakturor'}
          {stats.unpaid > 0 && (
            <>
              {' · '}
              <span className="text-foreground">{stats.unpaid} obetalda</span>
              {' · '}
              {formatCurrency(stats.unpaidAmount)} att få in
              {stats.overdue > 0 && (
                <>
                  {' · '}
                  <span className="text-destructive">{stats.overdue} förfallna</span>
                </>
              )}
            </>
          )}
        </p>
      )}

      {/* Search and tabs */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök fakturor"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        {/* Mobile: dropdown select */}
        <Select value={activeTab} onValueChange={setActiveTab}>
          <SelectTrigger className="sm:hidden w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla</SelectItem>
            <SelectItem value="unpaid">Obetalda</SelectItem>
            <SelectItem value="paid">Betalda</SelectItem>
            <SelectItem value="draft">Utkast</SelectItem>
            <SelectItem value="proforma">Proforma</SelectItem>
            <SelectItem value="delivery_note">Följesedel</SelectItem>
            <SelectItem value="credit">Kredit</SelectItem>
            <SelectItem value="cancelled">Makulerade</SelectItem>
          </SelectContent>
        </Select>
        {/* Desktop: tab bar */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="hidden sm:block">
          <TabsList>
            <TabsTrigger value="all">Alla</TabsTrigger>
            <TabsTrigger value="unpaid">Obetalda</TabsTrigger>
            <TabsTrigger value="paid">Betalda</TabsTrigger>
            <TabsTrigger value="draft">Utkast</TabsTrigger>
            <TabsTrigger value="proforma">Proforma</TabsTrigger>
            <TabsTrigger value="delivery_note">Följesedel</TabsTrigger>
            <TabsTrigger value="credit">Kredit</TabsTrigger>
            <TabsTrigger value="cancelled">Makulerade</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <DataList>
        {isLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="h-3 w-48 rounded bg-muted" />
              </div>
              <div className="h-5 w-24 rounded bg-muted" />
            </div>
          ))
        ) : filteredInvoices.length === 0 ? (
          searchTerm ? (
            <DataListEmpty
              icon={<Receipt className="h-6 w-6" />}
              title="Inga träffar"
              description={`Inga fakturor matchar "${searchTerm}".`}
            />
          ) : invoices.length === 0 ? (
            <EmptyInvoices />
          ) : (
            <DataListEmpty
              icon={<Receipt className="h-6 w-6" />}
              title="Inga fakturor i denna kategori"
              description="Prova att byta flik för att se fler fakturor."
            />
          )
        ) : (
          filteredInvoices.map((invoice) => {
            const status = statusConfig[invoice.status]
            const isCreditNote = !!invoice.credited_invoice_id
            const docType = (invoice as Invoice & { document_type?: string }).document_type || 'invoice'
            const isProforma = docType === 'proforma'
            const isDeliveryNote = docType === 'delivery_note'
            const relativeTime = invoice.due_date ? getRelativeTimeLabel(invoice.due_date, invoice.status) : null
            const displayedTotal = getDisplayTotal(
              { total: Number(invoice.total), currency: invoice.currency },
              { ore_rounding: oreRounding },
            ).displayed
            return (
              <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="block focus:outline-none">
                <DataListRow
                  trailing={
                    <div className="text-right">
                      <p
                        className={cn(
                          'font-medium tabular-nums leading-none',
                          isCreditNote && 'text-destructive'
                        )}
                      >
                        {formatCurrency(displayedTotal, invoice.currency)}
                      </p>
                      {invoice.currency !== 'SEK' && invoice.total_sek && (
                        <p
                          className={cn(
                            'mt-1 text-[11px] tabular-nums',
                            isCreditNote ? 'text-destructive/70' : 'text-muted-foreground'
                          )}
                        >
                          {formatCurrency(Number(invoice.total_sek))}
                        </p>
                      )}
                    </div>
                  }
                >
                  <DataListPrimary className={cn(!invoice.invoice_number && 'italic text-muted-foreground')}>
                    {invoiceNumberDisplay(invoice.invoice_number)}{' '}
                    <span className="font-normal text-muted-foreground">
                      · {(invoice.customer as { name: string })?.name}
                    </span>
                  </DataListPrimary>
                  <DataListMeta>
                    <span className="tabular-nums">{formatDate(invoice.invoice_date)}</span>
                    <DataListMetaSeparator />
                    <Badge
                      variant={status.variant as 'default' | 'secondary' | 'destructive'}
                      className="h-4 px-1.5 py-0 text-[10px]"
                    >
                      {status.label}
                    </Badge>
                    {isCreditNote && (
                      <>
                        <DataListMetaSeparator />
                        <Badge variant="destructive" className="h-4 px-1.5 py-0 text-[10px]">
                          Kredit
                        </Badge>
                      </>
                    )}
                    {isProforma && (
                      <>
                        <DataListMetaSeparator />
                        <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px]">
                          Proforma
                        </Badge>
                      </>
                    )}
                    {isDeliveryNote && (
                      <>
                        <DataListMetaSeparator />
                        <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px]">
                          Följesedel
                        </Badge>
                      </>
                    )}
                    {relativeTime && (
                      <>
                        <DataListMetaSeparator />
                        <span className={cn('font-medium', relativeTime.color)}>
                          {relativeTime.text}
                        </span>
                      </>
                    )}
                  </DataListMeta>
                </DataListRow>
              </Link>
            )
          })
        )}
      </DataList>
    </div>
  )
}
