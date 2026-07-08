import { getTranslations } from 'next-intl/server'
import { Brain } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { AccountNumber } from '@/components/ui/account-number'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateLong, formatCurrency } from '@/lib/utils'
import type { LedgerContext } from '@/lib/agent-context/ledger-context'
import type { DeepLedgerContext } from '@/lib/agent-context/ledger-deep'
import { LedgerGraph } from './LedgerGraph'

/** Recurring = a steady cadence (roughly weekly to quarterly) over >= 3 bookings. */
function isRecurring(cadence: number | null, occurrences: number): boolean {
  return cadence !== null && cadence >= 4 && cadence <= 120 && occurrences >= 3
}

/**
 * "Vad din agent vet": the human-readable render of the exact ledger-context
 * payload the AI agent reads. The hero is a radial map of how the company's
 * counterparties and suppliers flow into BAS accounts; the rest is compact
 * supporting context. Everything is derived by code from the company's own
 * bookings; the agent never invents it.
 */

// Swedish VAT (moms) treatment codes stay Swedish in both locales, like BAS
// account names and momsdeklaration labels (.claude/rules/i18n.md).
const VAT_LABELS: Record<string, string> = {
  standard_25: 'Moms 25%',
  standard_12: 'Moms 12%',
  standard_6: 'Moms 6%',
  reduced_12: 'Moms 12%',
  reduced_6: 'Moms 6%',
  reverse_charge: 'Omvänd moms',
  reverse_charge_eu: 'Omvänd moms (EU)',
  reverse_charge_services: 'Omvänd moms (tjänster)',
  eu_reverse_charge_services: 'Omvänd moms (EU-tjänster)',
  eu_goods: 'EU-varor',
  export: 'Export',
  exempt: 'Momsfri',
  no_vat: 'Ingen moms',
}

function vatLabel(code: string | null): string | null {
  if (!code) return null
  return VAT_LABELS[code] ?? code
}

export async function AgentKnowledgeView({
  context,
  deep,
  companyName,
}: {
  context: LedgerContext
  deep: DeepLedgerContext
  companyName: string
}) {
  const t = await getTranslations('agentKnowledge')

  const { meta, explicit_rules, vat_profile, conventions } = context

  const entities = [...deep.counterparty_entities, ...deep.supplier_entities]
  const recurringCount = entities.filter((e) => isRecurring(e.cadence_days, e.occurrences)).length
  const trackedSpend = entities.reduce((s, e) => s + e.total_amount, 0)

  // Empty only when there is nothing to show at all: no bookings, no derived
  // entities, AND no user-configured rules (rules are independent of posted
  // transactions, so a rules-only company must still render, not hit the
  // "hasn't learned anything" state).
  const isEmpty =
    meta.coverage.posted_entries_window === 0 &&
    entities.length === 0 &&
    explicit_rules.length === 0

  if (isEmpty) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            icon={Brain}
            title={t('empty_title')}
            description={t('empty_description')}
            actionLabel={t('empty_action')}
            actionHref="/transactions"
          />
        </CardContent>
      </Card>
    )
  }

  const methodLabel =
    conventions.accounting_method === 'accrual'
      ? t('method_accrual')
      : conventions.accounting_method === 'cash'
        ? t('method_cash')
        : t('method_unknown')

  const periodLabel =
    vat_profile.moms_period === 'monthly'
      ? t('period_monthly')
      : vat_profile.moms_period === 'quarterly'
        ? t('period_quarterly')
        : vat_profile.moms_period === 'yearly'
          ? t('period_yearly')
          : (vat_profile.moms_period ?? t('unknown'))

  return (
    <>
      {/* Coverage / freshness strip */}
      <Card>
        <CardContent className="flex flex-wrap gap-x-10 gap-y-4 p-4">
          <Stat label={t('meta_entities')} value={<span className="tabular-nums">{entities.length}</span>} />
          <Stat label={t('meta_recurring')} value={<span className="tabular-nums">{recurringCount}</span>} />
          <Stat label={t('meta_tracked_spend')} value={<span className="tabular-nums">{formatCurrency(trackedSpend)}</span>} />
          {conventions.typical_booking_lag_days !== null && (
            <Stat label={t('meta_lag')} value={t('meta_lag_value', { days: conventions.typical_booking_lag_days })} />
          )}
          <Stat label={t('meta_computed')} value={formatDateLong(meta.computed_at)} />
        </CardContent>
      </Card>

      {/* The radial map: the hero */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('graph_title')}</CardTitle>
          <CardDescription>{t('graph_description')}</CardDescription>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <LedgerGraph deep={deep} companyName={companyName} />
        </CardContent>
      </Card>

      {/* Explicit rules: instructions, authoritative, distinct from patterns */}
      {explicit_rules.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('rules_title')}</CardTitle>
            <CardDescription>{t('rules_description')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_rule')}</TableHead>
                  <TableHead>{t('col_match')}</TableHead>
                  <TableHead>{t('col_account')}</TableHead>
                  <TableHead>{t('col_vat')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {explicit_rules.map((r, i) => (
                  <TableRow key={r.rule_name + r.match + i}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.rule_name}</span>
                        <Badge variant="default">{t('src_rule')}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.match}</TableCell>
                    <TableCell>
                      {r.account_number
                        ? <AccountNumber number={r.account_number} showName size="sm" />
                        : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{vatLabel(r.vat_treatment) ?? '–'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* VAT profile + conventions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('vat_title')}</CardTitle>
            <CardDescription>{t('vat_description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <Row label={t('vat_registered_label')}>
              <Badge variant={vat_profile.registered ? 'success' : 'outline'}>
                {vat_profile.registered ? t('yes') : t('no')}
              </Badge>
            </Row>
            <Row label={t('vat_period_label')}>
              <span className="text-sm">{periodLabel}</span>
            </Row>
            <Row label={t('vat_treatments_label')}>
              {vat_profile.treatments_used_12m.length === 0 ? (
                <span className="text-sm text-muted-foreground">{t('vat_no_treatments')}</span>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  {vat_profile.treatments_used_12m.map((code) => (
                    <Badge key={code} variant="outline">{vatLabel(code)}</Badge>
                  ))}
                </div>
              )}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('conv_title')}</CardTitle>
            <CardDescription>{t('conv_description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <Row label={t('conv_method_label')}>
              <span className="text-sm">{methodLabel}</span>
            </Row>
            <Row label={t('conv_series_label')}>
              {conventions.voucher_series_in_use.length === 0 ? (
                <span className="text-sm text-muted-foreground">–</span>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  {conventions.voucher_series_in_use.map((s) => (
                    <Badge key={s} variant="secondary" className="font-mono">{s}</Badge>
                  ))}
                </div>
              )}
            </Row>
            <Row label={t('conv_salary_label')}>
              <Badge variant={conventions.salary_run_active ? 'success' : 'outline'}>
                {conventions.salary_run_active ? t('yes') : t('no')}
              </Badge>
            </Row>
            {conventions.typical_booking_lag_days !== null && (
              <Row label={t('conv_lag_label')}>
                <span className="text-sm tabular-nums">{t('meta_lag_value', { days: conventions.typical_booking_lag_days })}</span>
              </Row>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  )
}
