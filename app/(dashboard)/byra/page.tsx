import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Building2 } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getActiveCompanyId } from '@/lib/company/context'
import { getBureauPageData, MAX_FANOUT_CLIENTS } from '@/lib/bureau'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ClientRosterTable } from '@/components/bureau/ClientRosterTable'

export const dynamic = 'force-dynamic'
// A large roster fans out ~9 head-queries per client; keep headroom over the
// aggregation's own 20s global deadline (lib/bureau/overview.ts).
export const maxDuration = 60

/**
 * Byrå cockpit: read-only, urgency-sorted roster of every client company the
 * accountant is a member of, with jump-in. Writes always happen inside the
 * client company after switching. Entry point is the "Alla klienter" row in
 * CompanySwitcher; this page re-derives the same gate server-side.
 */
export default async function ByraPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Sandbox hides the byrå plane (dev_docs/nav_ia_redesign.md).
  const activeCompanyId = await getActiveCompanyId(supabase, user.id)
  if (activeCompanyId) {
    const { data: settings } = await supabase
      .from('company_settings')
      .select('is_sandbox')
      .eq('company_id', activeCompanyId)
      .maybeSingle()
    if (settings?.is_sandbox) redirect('/')
  }

  const t = await getTranslations('bureau')

  return (
    <div className="space-y-8">
      <PageHeader title={t('title')} />
      <Suspense fallback={<RosterSkeleton />}>
        <RosterSection userId={user.id} />
      </Suspense>
    </div>
  )
}

async function RosterSection({ userId }: { userId: string }) {
  const supabase = await createClient()
  const { eligibility, overview } = await getBureauPageData(
    supabase,
    createServiceClient(),
    userId,
  )
  const t = await getTranslations('bureau')

  if (!eligibility.eligible || !overview) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Building2}
            title={t('empty.title')}
            description={t('empty.description')}
            actionLabel={t('empty.action')}
            actionHref="/select-company"
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <ClientRosterTable
      rows={overview.clients}
      totals={overview.totals}
      failedCompanyIds={overview.failedCompanyIds}
      truncated={overview.truncated}
      fanoutLimit={MAX_FANOUT_CLIENTS}
    />
  )
}

function RosterSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-64" />
      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
