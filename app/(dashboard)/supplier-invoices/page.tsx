'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, FileInput, Lock } from 'lucide-react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { useCanWrite } from '@/lib/hooks/use-can-write'
import { formatDate } from '@/lib/utils'
import type { SupplierInvoice } from '@/types'

function formatAmount(amount: number): string {
  return amount.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const statusVariants: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  registered: 'secondary',
  approved: 'default',
  paid: 'success',
  partially_paid: 'warning',
  overdue: 'destructive',
  disputed: 'warning',
  credited: 'secondary',
  reversed: 'secondary',
}

const statusLabels: Record<string, string> = {
  registered: 'Registrerad',
  approved: 'Godkänd',
  paid: 'Betald',
  partially_paid: 'Delbetald',
  overdue: 'Förfallen',
  disputed: 'Tvist',
  credited: 'Krediterad',
  reversed: 'Makulerad',
}

export default function SupplierInvoicesPage() {
  const { canWrite } = useCanWrite()
  const [invoices, setInvoices] = useState<(SupplierInvoice & { supplier?: { id: string; name: string } })[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all')

  async function fetchInvoices() {
    setIsLoading(true)
    const res = await fetch('/api/supplier-invoices?status=all')
    const { data } = await res.json()
    setInvoices(data || [])
    setIsLoading(false)
  }

  useEffect(() => {
    fetchInvoices()
  }, [])

  const filteredInvoices = invoices.filter((inv) => {
    switch (activeTab) {
      case 'registered': return inv.status === 'registered'
      case 'approved': return inv.status === 'approved'
      case 'to_pay': return inv.status === 'approved' || inv.status === 'overdue'
      case 'paid': return inv.status === 'paid'
      default: return true
    }
  })

  return (
    <div className="space-y-8">
      <PageHeader
        title="Leverantörsfakturor"
        action={
          canWrite ? (
            <Link href="/supplier-invoices/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Registrera faktura
              </Button>
            </Link>
          ) : (
            <Button
              disabled
              title="Du har endast läsbehörighet i detta företag"
            >
              <Lock className="mr-2 h-4 w-4" />
              Registrera faktura
            </Button>
          )
        }
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">Alla</TabsTrigger>
          <TabsTrigger value="registered">Registrerade</TabsTrigger>
          <TabsTrigger value="approved">Godkända</TabsTrigger>
          <TabsTrigger value="to_pay">Att betala</TabsTrigger>
          <TabsTrigger value="paid">Betalda</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          {isLoading ? (
            <Card>
              <CardContent className="p-0">
                <div className="p-3 border-b">
                  <Skeleton className="h-4 w-full" />
                </div>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-4 p-3 border-b last:border-0">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20  ml-auto" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : filteredInvoices.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={FileInput}
                  title="Inga fakturor"
                  description={
                    activeTab === 'all'
                      ? 'Registrera leverantörsfakturor för att hålla koll på inköp och betalningar.'
                      : 'Inga fakturor i denna kategori.'
                  }
                  actionLabel={activeTab === 'all' && canWrite ? 'Registrera faktura' : undefined}
                  actionHref={activeTab === 'all' && canWrite ? '/supplier-invoices/new' : undefined}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ankomst</TableHead>
                      <TableHead>Leverantör</TableHead>
                      <TableHead>Fakturanr</TableHead>
                      <TableHead>Fakturadatum</TableHead>
                      <TableHead>Förfaller</TableHead>
                      <TableHead className="text-right">Belopp</TableHead>
                      <TableHead className="text-right">Kvar att betala</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono tabular-nums">{inv.arrival_number}</TableCell>
                        <TableCell>
                          <Link href={`/suppliers/${inv.supplier_id}`} className="hover:underline">
                            {inv.supplier?.name || '-'}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link href={`/supplier-invoices/${inv.id}`} className="text-primary hover:underline">
                            {inv.supplier_invoice_number}
                          </Link>
                        </TableCell>
                        <TableCell className="tabular-nums">{formatDate(inv.invoice_date)}</TableCell>
                        <TableCell className="tabular-nums">{formatDate(inv.due_date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatAmount(inv.total)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatAmount(inv.remaining_amount)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariants[inv.status] || 'secondary'}>
                            {statusLabels[inv.status] || inv.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
