'use client'

import { useTranslations } from 'next-intl'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { AlertCircle, ArrowUpRight, ArrowDownRight, Landmark, Link2, Loader2 } from 'lucide-react'
import type {
  SkattekontoMatchSuggestion,
  StoredSkattekontoTransaction,
} from '@/types/skatteverket'

/**
 * Skattekonto-rad in the /transactions inbox.
 *
 * Mirrors the visual rhythm of TransactionInboxCard (same icon circle, same
 * amount placement) but with SKV-specific actions: Bokför creates a draft via
 * the skatteverket extension; Matcha opens the shared dialog so users can
 * link the row to an already-booked manual transfer.
 *
 * The Skatteverket badge is the cue that this row is fundamentally different
 * from a bank tx — different counter-account (1630 vs 1930), different
 * categorization rules, no AI-suggested invoice matches.
 */
export default function SkattekontoInboxCard({
  row,
  matchSuggestion,
  processing,
  onBokfor,
  onMatch,
  onAnimationComplete,
}: {
  row: StoredSkattekontoTransaction
  matchSuggestion?: SkattekontoMatchSuggestion | null
  processing: boolean
  onBokfor: (row: StoredSkattekontoTransaction) => void
  onMatch: (row: StoredSkattekontoTransaction) => void
  onAnimationComplete?: (id: string) => void
}) {
  const t = useTranslations('tx_skattekonto_card')
  const amount = Number(row.belopp_skatteverket)
  const isIncome = amount > 0

  return (
    <motion.div
      layout
      initial={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, x: -16 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      onAnimationComplete={definition => {
        if (
          typeof definition === 'object' &&
          'opacity' in definition &&
          definition.opacity === 0
        ) {
          onAnimationComplete?.(row.id)
        }
      }}
    >
      <Card
        className={cn(
          'transition-colors',
          matchSuggestion ? 'border-warning' : 'border-warning/50',
        )}
      >
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div
                className={cn(
                  'h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0',
                  isIncome
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive',
                )}
                aria-hidden="true"
              >
                {isIncome ? (
                  <ArrowUpRight className="h-5 w-5" />
                ) : (
                  <ArrowDownRight className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium truncate">{row.transaktionstext}</p>
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Landmark className="h-3 w-3" />
                    {t('skv_badge')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {formatDate(row.transaktionsdatum)}
                </p>
              </div>
            </div>

            <div className="text-right flex-shrink-0">
              <p
                className={cn(
                  'font-medium tabular-nums',
                  isIncome && 'text-success',
                )}
              >
                {isIncome ? '+' : ''}
                {formatCurrency(amount)}
              </p>
            </div>
          </div>

          {matchSuggestion && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-warning" />
              <div className="min-w-0">
                <p className="font-medium">
                  {matchSuggestion.voucher_series && matchSuggestion.voucher_number
                    ? t('duplicate_title_with_voucher', { label: `${matchSuggestion.voucher_series}${matchSuggestion.voucher_number}` })
                    : t('duplicate_title_draft')}
                </p>
                <p className="text-muted-foreground truncate">
                  {matchSuggestion.entry_date} • {matchSuggestion.description}
                </p>
                <p className="text-muted-foreground">
                  {t('duplicate_body')}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t">
            {matchSuggestion ? (
              <>
                <Button
                  size="sm"
                  variant="default"
                  className="h-9 text-xs"
                  onClick={() => onMatch(row)}
                  disabled={processing}
                >
                  <Link2 className="mr-1.5 h-3 w-3" />
                  {t('link_to_voucher')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-xs"
                  onClick={() => onBokfor(row)}
                  disabled={processing}
                >
                  {processing ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : null}
                  {t('book_anyway')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="default"
                  className="h-9 text-xs"
                  onClick={() => onBokfor(row)}
                  disabled={processing}
                >
                  {processing ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : null}
                  {t('book')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 text-xs"
                  onClick={() => onMatch(row)}
                  disabled={processing}
                >
                  <Link2 className="mr-1.5 h-3 w-3" />
                  {t('match_to_voucher')}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
