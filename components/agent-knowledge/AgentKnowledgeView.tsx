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
import { formatDate, formatDateLong } from '@/lib/utils'
import type { LedgerContext } from '@/lib/agent-context/ledger-context'

/**
 * "Vad din agent vet": the human-readable render of the exact ledger-context
 * payload the AI agent reads (Accounted://ledger/context + the briefing
 * digest). One payload, two renderers; this is the trust/legibility surface.
 * Everything shown is derived by code from the company's own bookings; the
 * agent never invents it.
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

/** Monochrome share meter (0..1). On-brand: muted track, achromatic fill. */
function ShareBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)))
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${pct}%`}
      >
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  )
}

export async function AgentKnowledgeView({ context }: { context: LedgerContext }) {
  const t = await getTranslations('agentKnowledge')

  const {
    meta,
    account_usage,
    counterparty_patterns,
    supplier_patterns,
    explicit_rules,
    vat_profile,
    conventions,
  } = context

  const isEmpty =
    meta.coverage.posted_entries_window === 0 &&
    counterparty_patterns.length === 0 &&
    supplier_patterns.length === 0 &&
    account_usage.length === 0

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
          <Stat label={t('meta_window')} value={`${formatDate(meta.window.from)} – ${formatDate(meta.window.to)}`} />
          <Stat label={t('meta_posted_entries')} value={<span className="tabular-nums">{meta.coverage.posted_entries_window}</span>} />
          {conventions.typical_booking_lag_days !== null && (
            <Stat label={t('meta_lag')} value={t('meta_lag_value', { days: conventions.typical_booking_lag_days })} />
          )}
          <Stat label={t('meta_computed')} value={formatDateLong(meta.computed_at)} />
        </CardContent>
      </Card>

      {/* Counterparty booking patterns: the crown jewel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cp_title')}</CardTitle>
          <CardDescription>{t('cp_description')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {counterparty_patterns.length === 0 ? (
            <EmptyRow text={t('none_cp')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_counterparty')}</TableHead>
                  <TableHead>{t('col_account')}</TableHead>
                  <TableHead>{t('col_vat')}</TableHead>
                  <TableHead>{t('col_evidence')}</TableHead>
                  <TableHead className="text-right">{t('col_last')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counterparty_patterns.map((p) => (
                  <TableRow key={p.counterparty + p.dominant.account_number}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{p.counterparty}</span>
                        <Badge variant={p.source === 'template' ? 'secondary' : 'outline'}>
                          {p.source === 'template' ? t('src_template') : t('src_observed')}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.dominant.account_number
                        ? <AccountNumber number={p.dominant.account_number} showName size="sm" />
                        : <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{vatLabel(p.dominant.vat_treatment) ?? '–'}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <ShareBar value={p.evidence.share} />
                        <span className="text-xs text-muted-foreground">
                          {t('ev_counts', { agree: p.evidence.agree, seen: p.evidence.seen_12m })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatDate(p.evidence.last_booked)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Supplier booking patterns (AP side) */}
      {supplier_patterns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('sup_title')}</CardTitle>
            <CardDescription>{t('sup_description')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_supplier')}</TableHead>
                  <TableHead>{t('col_account')}</TableHead>
                  <TableHead>{t('col_vat')}</TableHead>
                  <TableHead>{t('col_evidence')}</TableHead>
                  <TableHead className="text-right">{t('col_last')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplier_patterns.map((s) => (
                  <TableRow key={s.supplier + s.dominant.account_number}>
                    <TableCell className="font-medium">{s.supplier}</TableCell>
                    <TableCell>
                      <AccountNumber number={s.dominant.account_number} showName size="sm" />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{vatLabel(s.dominant.vat_treatment) ?? '–'}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <ShareBar value={s.evidence.share} />
                        <span className="text-xs text-muted-foreground">
                          {t('ev_counts', { agree: s.evidence.agree, seen: s.evidence.seen_12m })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatDate(s.evidence.last_booked)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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

      {/* Account usage */}
      {account_usage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('acc_title')}</CardTitle>
            <CardDescription>{t('acc_description')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_account')}</TableHead>
                  <TableHead className="text-right">{t('col_postings')}</TableHead>
                  <TableHead className="text-right">{t('col_last_used')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account_usage.map((a) => (
                  <TableRow key={a.account_number}>
                    <TableCell>
                      <AccountNumber number={a.account_number} name={a.account_name ?? undefined} showName size="sm" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{a.postings_12m}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatDate(a.last_used)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* VAT profile + conventions, side by side */}
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
                <div className="flex flex-wrap justify-end gap-1.5">
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
                <div className="flex flex-wrap justify-end gap-1.5">
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

function EmptyRow({ text }: { text: string }) {
  return <p className="px-6 py-8 text-center text-sm text-muted-foreground">{text}</p>
}
