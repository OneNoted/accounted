import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Building2 } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
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
 * "Alla företag": read-only, urgency-sorted roster of every company the user
 * is a member of, with jump-in. Useful to any multi-company user (bureaus,
 * holding structures, serial founders); the byrå-branded version of this
 * surface arrives later behind a team-scoped capability. Writes always
 * happen inside a company after switching. Entry point is the "Alla företag"
 * row in CompanySwitcher; the (firm) layout owns auth + the sandbox gate.
 */
export default async function CompaniesOverviewPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
