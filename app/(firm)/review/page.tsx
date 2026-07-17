import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Building2 } from 'lucide-react'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getBureauReviewData } from '@/lib/bureau/review'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ReviewQueue } from '@/components/bureau/ReviewQueue'

export const dynamic = 'force-dynamic'

/**
 * Firm-altitude Granskning: the manage-by-exception queue over every
 * client's pending staged operations (the agent-governance surface: the
 * agent stages, the human approves inside the client after jump-in).
 */
export default async function FirmReviewPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const t = await getTranslations('bureau')

  return (
    <div className="space-y-8">
      <PageHeader title={t('nav.review')} />
      <Suspense fallback={<ReviewSkeleton />}>
        <ReviewSection userId={user.id} />
      </Suspense>
    </div>
  )
}

async function ReviewSection({ userId }: { userId: string }) {
  const supabase = await createClient()
  const { eligibility, groups, totals } = await getBureauReviewData(
    supabase,
    createServiceClient(),
    userId,
  )
  const t = await getTranslations('bureau')

  if (!eligibility.eligible || groups === null) {
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

  return <ReviewQueue groups={groups} totals={totals} />
}

function ReviewSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-64" />
      {[1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="p-0">
            <div className="px-6 py-4 border-b border-border">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="divide-y divide-border">
              {[1, 2, 3].map((j) => (
                <div key={j} className="flex items-center justify-between px-6 py-3">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-4 w-14" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
