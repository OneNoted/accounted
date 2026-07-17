'use client'

import { useTranslations } from 'next-intl'
import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import type { ClientReviewGroup, ReviewRiskLevel } from '@/lib/bureau/review'
import { OpenClientButton } from './OpenClientButton'

/** Items rendered per client before collapsing into an overflow count. */
const ITEMS_SHOWN = 6

function RiskBadge({ level }: { level: ReviewRiskLevel }) {
  const t = useTranslations('bureau')
  if (level === 'high') return <Badge variant="destructive">{t('review.risk.high')}</Badge>
  if (level === 'medium') return <Badge variant="warning">{t('review.risk.medium')}</Badge>
  return <span className="text-xs text-muted-foreground">{t('review.risk.low')}</span>
}

/**
 * Firm-level manage-by-exception queue: every client's pending staged
 * operations, most urgent client first (high risk, then oldest backlog: an
 * aging queue must never hide). Approval itself happens inside the client
 * (/pending) after jump-in; this surface answers "where is judgment needed".
 */
export function ReviewQueue({
  groups,
  totals,
}: {
  groups: ClientReviewGroup[]
  totals: { items: number; highRisk: number; clients: number }
}) {
  const t = useTranslations('bureau')

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        <CheckCircle2 className="inline h-4 w-4 mr-2 align-[-2px]" aria-hidden />
        {t('review.all_clear')}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground tabular-nums" role="status" aria-live="polite">
        {t('review.summary', {
          items: totals.items,
          high: totals.highRisk,
          clients: totals.clients,
        })}
      </p>

      {groups.map((group) => {
        const overflow = group.totalPending - ITEMS_SHOWN
        return (
          <Card key={group.companyId}>
            <CardContent className="p-0">
              <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{group.name}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t('review.count', { count: group.totalPending })}
                    {' · '}
                    {t('review.oldest', { date: formatDate(group.oldestCreatedAt) })}
                  </p>
                </div>
                <OpenClientButton
                  companyId={group.companyId}
                  name={group.name}
                  target="/pending"
                />
              </div>
              <ul className="divide-y divide-border">
                {group.items.slice(0, ITEMS_SHOWN).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-4 px-6 py-3">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(`review.actor.${item.actorType}`)}
                        {' · '}
                        <span className="tabular-nums">{formatDate(item.createdAt)}</span>
                      </p>
                    </div>
                    <RiskBadge level={item.riskLevel} />
                  </li>
                ))}
                {overflow > 0 && (
                  <li className="px-6 py-3 text-xs text-muted-foreground">
                    {t('review.overflow', { count: overflow })}
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
