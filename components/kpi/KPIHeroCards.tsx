'use client'

import { Card, CardContent } from '@/components/ui/card'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import { formatCurrency } from '@/lib/utils'
import { KPI_DEFINITIONS, getDefaultPreferences } from '@/lib/reports/kpi-definitions'
import type { KPIReport, KPIPreferences } from '@/types'

interface KPIHeroCardsProps {
  report: KPIReport
  preferences?: KPIPreferences
}

function getKPIValue(
  report: KPIReport,
  id: string
): { value: number | null; subtitle: string } {
  switch (id) {
    case 'netResult':
      return { value: report.netResult, subtitle: 'netto' }
    case 'cashPosition':
      return { value: report.cashPosition, subtitle: 'likvida medel' }
    case 'outstandingReceivables':
      return {
        value: report.outstandingReceivables,
        subtitle:
          report.overdueReceivables > 0
            ? `varav förfallet: ${formatCurrency(report.overdueReceivables)}`
            : 'utestående',
      }
    case 'vatLiability':
      return {
        value: report.vatLiability,
        subtitle:
          report.vatLiability > 0
            ? 'att betala'
            : report.vatLiability < 0
              ? 'att återfå'
              : 'jämnt',
      }
    case 'grossMargin':
      return { value: report.grossMargin, subtitle: 'av intäkter' }
    case 'expenseRatio':
      return { value: report.expenseRatio, subtitle: 'av intäkter' }
    case 'avgPaymentDays':
      return { value: report.avgPaymentDays, subtitle: 'snitt' }
    default:
      return { value: null, subtitle: '' }
  }
}

function formatKPIValue(value: number | null, format: string, id: string): string {
  if (value === null) return '—'
  if (format === 'currency') {
    if (id === 'vatLiability') return formatCurrency(Math.abs(value))
    return formatCurrency(value)
  }
  if (format === 'percentage') return `${value}%`
  if (format === 'days') return `${value} dagar`
  return String(value)
}

function getValueColor(
  value: number | null,
  colorLogic: string
): string {
  if (value === null) return 'text-muted-foreground'
  if (colorLogic === 'neutral') return ''
  if (colorLogic === 'positive-good') {
    return value >= 0
      ? 'text-[hsl(var(--chart-1))]'
      : 'text-[hsl(var(--chart-2))]'
  }
  if (colorLogic === 'negative-good') {
    return value <= 0
      ? 'text-[hsl(var(--chart-1))]'
      : 'text-[hsl(var(--chart-2))]'
  }
  return ''
}

export function KPIHeroCards({ report, preferences }: KPIHeroCardsProps) {
  const prefs = preferences ?? getDefaultPreferences()

  const visibleDefs = prefs.kpiOrder
    .map((id) => KPI_DEFINITIONS.find((d) => d.id === id))
    .filter((d) => d && prefs.visibleKpis.includes(d.id)) as typeof KPI_DEFINITIONS

  if (visibleDefs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Inga nyckeltal valda. Klicka på &quot;Anpassa&quot; för att välja vilka som ska visas.
        </CardContent>
      </Card>
    )
  }

  const gridCols =
    visibleDefs.length <= 2
      ? 'grid-cols-2'
      : visibleDefs.length === 3
        ? 'grid-cols-2 md:grid-cols-3'
        : 'grid-cols-2 md:grid-cols-4'

  return (
    <div className={`grid ${gridCols} gap-4`}>
      {visibleDefs.map((def) => {
        const { value, subtitle } = getKPIValue(report, def.id)
        const formatted = formatKPIValue(value, def.format, def.id)
        const color = getValueColor(value, def.colorLogic)
        const hasOverride =
          prefs.accountOverrides[def.id] &&
          prefs.accountOverrides[def.id].length > 0

        const tooltipContent = (
          <div className="space-y-1.5 text-xs">
            <p className="text-foreground/90">{def.description}</p>
            <div>
              <span className="font-medium">Formel: </span>
              <span className="font-mono">{def.formula}</span>
            </div>
            <div>
              <span className="font-medium">Konton: </span>
              {def.accountDescription}
            </div>
            {hasOverride && (
              <div className="text-primary">
                <span className="font-medium">Anpassade: </span>
                <span className="font-mono">
                  {prefs.accountOverrides[def.id].join(', ')}
                </span>
              </div>
            )}
          </div>
        )

        return (
          <Card key={def.id}>
            <CardContent className="p-6">
              <InfoTooltip
                content={tooltipContent}
                side="top"
                maxWidth="320px"
                iconClassName="h-3 w-3"
              >
                <p className="text-xs text-muted-foreground">{def.label}</p>
              </InfoTooltip>
              <p
                className={`font-display text-2xl font-medium tabular-nums tracking-tight mt-2 ${color}`}
              >
                {formatted}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {subtitle}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
