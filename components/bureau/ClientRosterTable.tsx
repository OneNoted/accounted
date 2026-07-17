'use client'

import { useTranslations } from 'next-intl'
import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import {
  bureauRowStatus,
  type BureauClientRow,
  type BureauRowStatus,
} from '@/lib/bureau/types'
import { WORKLIST_CATEGORIES, type WorklistCategory } from '@/lib/worklist/types'
import { OpenClientButton } from './OpenClientButton'

/**
 * One urgency indicator per row (the roster's single status vocabulary).
 * 'klart' deliberately renders as quiet muted text, not a badge: the calm
 * default state should not carry a color chip on 90% of rows.
 */
const STATUS_VARIANTS: Record<
  Exclude<BureauRowStatus, 'klart'>,
  'secondary' | 'warning' | 'destructive'
> = {
  pagar: 'secondary',
  nara_deadline: 'warning',
  forsenad: 'destructive',
}

interface ClientRosterTableProps {
  rows: BureauClientRow[]
  totals: { clients: number; worklistTotal: number; overdueDeadlines: number }
  failedCompanyIds: string[]
  truncated: boolean
  fanoutLimit: number
}

/** Top two non-zero worklist categories in words: "9 att bokföra · 3 att attestera". */
function topCategories(
  row: BureauClientRow,
  t: (key: string, values?: Record<string, string | number>) => string,
): string | null {
  const worklist = row.worklist
  if (!worklist || worklist.total === 0) return null
  const ranked = WORKLIST_CATEGORIES
    .filter((c): c is WorklistCategory => c !== 'suggested_match')
    .map((category) => ({ category, count: worklist.counts[category] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
  if (ranked.length === 0) return null
  return ranked.map((entry) => `${entry.count} ${t(`cat.${entry.category}`)}`).join(' · ')
}

function StatusCell({ status }: { status: BureauRowStatus }) {
  const t = useTranslations('bureau')
  if (status === 'klart') {
    return <span className="text-sm text-muted-foreground">{t('status.klart')}</span>
  }
  return <Badge variant={STATUS_VARIANTS[status]}>{t(`status.${status}`)}</Badge>
}

function PeriodCell({ row }: { row: BureauClientRow }) {
  const t = useTranslations('bureau')
  const period = row.periodStatus
  if (!period) return <span className="text-sm text-muted-foreground">–</span>
  // bookkeeping_locked_through is the informative month-close signal; the
  // period enum alone reads "Öppen" on virtually every row (periods are
  // whole fiscal years).
  if (period.lockedThrough) {
    return (
      <span className="text-sm text-muted-foreground tabular-nums">
        {t('period_locked_through', { date: formatDate(period.lockedThrough) })}
      </span>
    )
  }
  if (period.status === 'closed') {
    return <Badge variant="success">{t('period_status.closed')}</Badge>
  }
  if (period.status === 'locked') {
    return <Badge variant="secondary">{t('period_status.locked')}</Badge>
  }
  return <span className="text-sm text-muted-foreground">{t('period_status.open')}</span>
}

export function ClientRosterTable({
  rows,
  totals,
  failedCompanyIds,
  truncated,
  fanoutLimit,
}: ClientRosterTableProps) {
  const t = useTranslations('bureau')
  const failed = new Set(failedCompanyIds)
  const allClear =
    failed.size === 0 &&
    !truncated &&
    rows.every((row) => bureauRowStatus(row) === 'klart' && row.worklist !== null)

  return (
    <div className="space-y-4">
      {allClear ? (
        <p className="text-sm text-muted-foreground" role="status">
          <CheckCircle2 className="inline h-4 w-4 mr-2 align-[-2px]" aria-hidden />
          {t('all_clear')}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground tabular-nums" role="status" aria-live="polite">
          {t('summary', {
            clients: totals.clients,
            tasks: totals.worklistTotal,
            overdue: totals.overdueDeadlines,
          })}
        </p>
      )}
      {truncated && (
        <p className="text-sm text-muted-foreground">
          {t('truncated_notice', { count: fanoutLimit })}
        </p>
      )}

      {/* Desktop table */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <Table>
            <caption className="sr-only">{t('title')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.client')}</TableHead>
                <TableHead>{t('col.status')}</TableHead>
                <TableHead className="text-right">{t('col.todo')}</TableHead>
                <TableHead>{t('col.deadline')}</TableHead>
                <TableHead>{t('col.period')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const status = bureauRowStatus(row)
                const breakdown = topCategories(row, t)
                const worklist = row.worklist
                return (
                  <TableRow key={row.companyId}>
                    <TableCell>
                      <p className="text-sm truncate max-w-[220px]">{row.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(`entity.${row.entityType}`)}
                      </p>
                    </TableCell>
                    {worklist === null ? (
                      <TableCell colSpan={4} className="text-sm text-muted-foreground italic">
                        {failed.has(row.companyId) ? t('row_error') : '–'}
                      </TableCell>
                    ) : (
                      <>
                        <TableCell>
                          <StatusCell status={status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-display text-base tabular-nums">
                            {worklist.total}
                          </span>
                          {breakdown && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px] ml-auto">
                              {breakdown}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.nextDeadline ? (
                            <>
                              <span className="text-sm tabular-nums">
                                {formatDate(row.nextDeadline.dueDate)}
                              </span>
                              <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {row.nextDeadline.title}
                              </p>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">–</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <PeriodCell row={row} />
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-right">
                      <OpenClientButton companyId={row.companyId} name={row.name} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Mobile card list */}
      <div className="space-y-3 md:hidden">
        {rows.map((row) => {
          const status = bureauRowStatus(row)
          const worklist = row.worklist
          return (
            <Card key={row.companyId}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium truncate">{row.name}</p>
                  {worklist !== null && <StatusCell status={status} />}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {worklist === null
                    ? failed.has(row.companyId)
                      ? t('row_error')
                      : '–'
                    : [
                        `${worklist.total} ${t('col.todo').toLowerCase()}`,
                        row.nextDeadline ? formatDate(row.nextDeadline.dueDate) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
                <OpenClientButton
                  companyId={row.companyId}
                  name={row.name}
                  className="w-full h-11"
                />
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
