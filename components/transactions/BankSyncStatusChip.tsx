'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useCompany } from '@/contexts/CompanyContext'

interface ConnectionRow {
  id: string
  status: string | null
  last_synced_at: string | null
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just nu'
  if (min < 60) return `${min} min sedan`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} tim sedan`
  const d = Math.floor(h / 24)
  return `${d} d sedan`
}

export default function BankSyncStatusChip() {
  const { company } = useCompany()
  const [rows, setRows] = useState<ConnectionRow[] | null>(null)

  useEffect(() => {
    if (!company?.id) return
    let cancelled = false
    const supabase = createClient()
    supabase
      .from('bank_connections')
      .select('id, status, last_synced_at')
      .eq('company_id', company.id)
      .then(({ data }) => {
        if (!cancelled) setRows(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [company?.id])

  if (!rows || rows.length === 0) return null

  const needsAttention = rows.filter(
    (r) => r.status === 'expired' || r.status === 'error',
  )

  if (needsAttention.length > 0) {
    return (
      <Link
        href="/settings/banking"
        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>
          {needsAttention.length === 1
            ? '1 bankanslutning behöver förnyas'
            : `${needsAttention.length} bankanslutningar behöver förnyas`}
        </span>
      </Link>
    )
  }

  const mostRecent = rows
    .map((r) => r.last_synced_at)
    .filter((s): s is string => Boolean(s))
    .sort()
    .pop()

  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
      <RefreshCw className="h-3.5 w-3.5" />
      <span>
        Synkas automatiskt varje natt
        {mostRecent && (
          <>
            {' · senast '}
            <span className="tabular-nums">{formatAge(mostRecent)}</span>
          </>
        )}
      </span>
    </div>
  )
}
