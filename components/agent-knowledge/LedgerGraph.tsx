'use client'

import { useEffect, useMemo, useState } from 'react'
import { getAccountDescription } from '@/lib/bookkeeping/account-descriptions'
import { useTranslations } from 'next-intl'
import { cn, formatCurrency } from '@/lib/utils'
import type { DeepEntity, DeepLedgerContext } from '@/lib/agent-context/ledger-deep'

/**
 * Radial-hub map of "what your agent knows": the company at the center, the
 * BAS accounts it books to on an inner ring (sized by throughput), and the
 * counterparties/suppliers fanning out on an outer ring, each spoked to its
 * dominant account. Node size = how often it's booked; hover/focus reveals the
 * deep facts (name variants merged, total paid, recurrence cadence, dominant
 * account + consistency). Pure, deterministic SVG layout (no physics). Nodes
 * are keyboard-focusable with per-node accessible names, and a visually-hidden
 * data table carries the full payload for screen readers.
 */

const W = 760
const H = 760
const CX = W / 2
const CY = H / 2
const R_ACCOUNT = 150
const R_PAYEE = 302
const MAX_ACCOUNTS = 8
const MAX_PER_ACCOUNT = 7

const C = {
  border: 'hsl(var(--border))',
  fg: 'hsl(var(--foreground))',
  muted: 'hsl(var(--muted-foreground))',
  card: 'hsl(var(--card))',
  bg: 'hsl(var(--background))',
  secondary: 'hsl(var(--secondary))',
  primary: 'hsl(var(--primary))',
}

interface PayeeNode {
  id: string
  entity: DeepEntity
  account: string
  x: number
  y: number
  r: number
}
interface AccountNode {
  id: string
  number: string
  weight: number
  x: number
  y: number
  r: number
  payeeIds: string[]
}
interface Model {
  accounts: AccountNode[]
  payees: PayeeNode[]
  truncated: boolean
}

function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

function buildModel(deep: DeepLedgerContext): Model {
  const all: DeepEntity[] = [
    ...(deep?.counterparty_entities ?? []),
    ...(deep?.supplier_entities ?? []),
  ].filter((e) => e.dominant_account_number)

  const byAccount = new Map<string, DeepEntity[]>()
  for (const e of all) {
    const acc = e.dominant_account_number as string
    const arr = byAccount.get(acc) ?? []
    arr.push(e)
    byAccount.set(acc, arr)
  }

  let groups = [...byAccount.entries()].map(([number, items]) => ({
    number,
    items: items.slice().sort((a, b) => b.occurrences - a.occurrences),
    weight: items.reduce((s, i) => s + i.occurrences, 0),
  }))
  groups.sort((a, b) => b.weight - a.weight)

  const totalAccounts = groups.length
  groups = groups.slice(0, MAX_ACCOUNTS)
  let truncated = totalAccounts > groups.length
  for (const g of groups) {
    if (g.items.length > MAX_PER_ACCOUNT) {
      truncated = true
      g.items = g.items.slice(0, MAX_PER_ACCOUNT)
    }
  }

  const shownPayeeCount = groups.reduce((s, g) => s + g.items.length, 0) || 1
  const maxAccW = Math.max(...groups.map((g) => g.weight), 1)
  const maxPayeeW = Math.max(...groups.flatMap((g) => g.items.map((i) => i.occurrences)), 1)

  const accounts: AccountNode[] = []
  const payees: PayeeNode[] = []

  let angle = -Math.PI / 2
  for (const g of groups) {
    const width = (2 * Math.PI * g.items.length) / shownPayeeCount
    const mid = angle + width / 2
    const apos = polar(CX, CY, R_ACCOUNT, mid)
    const aId = `acc:${g.number}`
    const payeeIds: string[] = []

    const pad = Math.min(width * 0.28, 0.16)
    const n = g.items.length
    g.items.forEach((e, i) => {
      const t = n === 1 ? 0.5 : i / (n - 1)
      const pa = angle + pad + t * (width - 2 * pad)
      const ppos = polar(CX, CY, R_PAYEE, pa)
      const id = `pay:${g.number}:${e.key}:${i}`
      payees.push({
        id,
        entity: e,
        account: g.number,
        x: ppos.x,
        y: ppos.y,
        r: 5 + 8 * Math.sqrt(e.occurrences / maxPayeeW),
      })
      payeeIds.push(id)
    })

    accounts.push({
      id: aId,
      number: g.number,
      weight: g.weight,
      x: apos.x,
      y: apos.y,
      r: 13 + 15 * Math.sqrt(g.weight / maxAccW),
      payeeIds,
    })
    angle += width
  }

  return { accounts, payees, truncated }
}

function cadenceKey(cadence: number | null, occurrences: number): 'cadence_weekly' | 'cadence_monthly' | 'cadence_quarterly' | null {
  if (cadence === null || occurrences < 3 || cadence < 4 || cadence > 120) return null
  if (cadence <= 10) return 'cadence_weekly'
  if (cadence <= 45) return 'cadence_monthly'
  return 'cadence_quarterly'
}

export function LedgerGraph({ deep, companyName }: { deep: DeepLedgerContext; companyName: string }) {
  const t = useTranslations('agentKnowledge')
  const [hover, setHover] = useState<string | null>(null)
  // Gentle one-shot fade-in of the whole map on mount. The svg root has no
  // opacity attribute of its own (only the inner node groups do, for hover
  // dimming), so this never fights the interaction state. Reduced-motion users
  // get it instantly.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const model = useMemo(() => buildModel(deep), [deep])

  const payeeById = useMemo(() => new Map(model.payees.map((p) => [p.id, p])), [model])
  const accountById = useMemo(() => new Map(model.accounts.map((a) => [a.id, a])), [model])

  // Rich accessible name / caption for an entity node.
  function payeeCaption(e: DeepEntity): string {
    const nm = getAccountDescription(e.dominant_account_number ?? '')?.name
    const ck = cadenceKey(e.cadence_days, e.occurrences)
    return [
      e.name,
      t('cap_bookings', { n: e.occurrences }),
      e.variant_count > 1 ? t('cap_variants', { n: e.variant_count }) : null,
      ck ? t(ck) : null,
      formatCurrency(e.total_amount),
      `${e.dominant_account_number}${nm ? ` ${nm}` : ''}${
        e.dominant_account_share !== null ? ` (${Math.round(e.dominant_account_share * 100)}%)` : ''
      }`,
    ]
      .filter(Boolean)
      .join(' · ')
  }
  function accountCaption(a: AccountNode): string {
    const nm = getAccountDescription(a.number)?.name
    return `${a.number}${nm ? ` · ${nm}` : ''} · ${t('graph_account_caption', { count: a.payeeIds.length })}`
  }

  if (model.payees.length === 0) {
    return <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t('none_cp')}</p>
  }

  const active = new Set<string>()
  if (hover) {
    active.add(hover)
    if (hover.startsWith('acc:')) {
      accountById.get(hover)?.payeeIds.forEach((id) => active.add(id))
    } else {
      const p = payeeById.get(hover)
      if (p) active.add(`acc:${p.account}`)
    }
  }
  const dim = (id: string) => (hover && !active.has(id) ? 0.12 : 1)

  const initials =
    companyName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '•'

  let caption = t('graph_hint')
  if (hover?.startsWith('acc:')) {
    const a = accountById.get(hover)
    if (a) caption = accountCaption(a)
  } else if (hover) {
    const p = payeeById.get(hover)
    if (p) caption = payeeCaption(p.entity)
  }

  return (
    <div>
      <div className="w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={cn(
            'mx-auto block h-auto w-full max-w-[640px] transition-opacity duration-700 ease-out motion-reduce:transition-none',
            shown ? 'opacity-100' : 'opacity-0',
          )}
          role="img"
          aria-label={t('graph_aria', { payees: model.payees.length, accounts: model.accounts.length })}
        >
          {model.accounts.map((a) =>
            a.payeeIds.map((pid) => {
              const p = payeeById.get(pid)!
              const share = p.entity.dominant_account_share ?? 0.7
              const on = !hover || active.has(a.id) || active.has(pid)
              return (
                <line
                  key={`e:${pid}`}
                  x1={a.x}
                  y1={a.y}
                  x2={p.x}
                  y2={p.y}
                  stroke={C.fg}
                  strokeWidth={0.8 + 1.4 * share}
                  strokeOpacity={on ? 0.18 + 0.5 * share : 0.05}
                />
              )
            }),
          )}
          {model.accounts.map((a) => {
            const on = !hover || active.has(a.id)
            return (
              <line
                key={`c:${a.id}`}
                x1={CX}
                y1={CY}
                x2={a.x}
                y2={a.y}
                stroke={C.muted}
                strokeWidth={1.4}
                strokeOpacity={on ? 0.4 : 0.06}
              />
            )
          })}

          {model.payees.map((p) => {
            const a = Math.atan2(p.y - CY, p.x - CX)
            const right = Math.cos(a) >= 0
            const lx = p.x + (right ? p.r + 5 : -(p.r + 5))
            const label = p.entity.name.length > 16 ? p.entity.name.slice(0, 15) + '…' : p.entity.name
            const focused = hover === p.id
            return (
              <g
                key={p.id}
                opacity={dim(p.id)}
                tabIndex={0}
                role="button"
                aria-label={payeeCaption(p.entity)}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p.id)}
                onBlur={() => setHover(null)}
                className="cursor-pointer outline-none"
              >
                <title>{payeeCaption(p.entity)}</title>
                {focused && (
                  <circle cx={p.x} cy={p.y} r={p.r + 4} fill="none" stroke={C.fg} strokeWidth={1.5} />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.r}
                  fill={p.entity.kind === 'supplier' ? C.secondary : C.card}
                  stroke={C.fg}
                  strokeWidth={1}
                  strokeOpacity={0.55}
                />
                <text
                  x={lx}
                  y={p.y}
                  fill={C.muted}
                  fontSize={11}
                  dominantBaseline="middle"
                  textAnchor={right ? 'start' : 'end'}
                >
                  {label}
                </text>
              </g>
            )
          })}

          {model.accounts.map((a) => {
            const focused = hover === a.id
            return (
              <g
                key={a.id}
                opacity={dim(a.id)}
                tabIndex={0}
                role="button"
                aria-label={accountCaption(a)}
                onMouseEnter={() => setHover(a.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(a.id)}
                onBlur={() => setHover(null)}
                className="cursor-pointer outline-none"
              >
                <title>{accountCaption(a)}</title>
                {focused && (
                  <circle cx={a.x} cy={a.y} r={a.r + 4} fill="none" stroke={C.fg} strokeWidth={1.5} />
                )}
                <circle cx={a.x} cy={a.y} r={a.r} fill={C.secondary} stroke={C.fg} strokeWidth={1.25} strokeOpacity={0.85} />
                <text
                  x={a.x}
                  y={a.y}
                  fill={C.fg}
                  fontSize={13}
                  fontWeight={500}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontFamily: 'var(--font-geist-mono, ui-monospace, monospace)' }}
                >
                  {a.number}
                </text>
              </g>
            )
          })}

          <g>
            <circle cx={CX} cy={CY} r={40} fill={C.fg} />
            <text x={CX} y={CY} fill={C.bg} fontSize={20} fontWeight={500} textAnchor="middle" dominantBaseline="middle">
              {initials}
            </text>
          </g>
        </svg>
      </div>

      <div className="mt-2 min-h-6 px-2 text-center text-sm text-muted-foreground" aria-live="polite">
        {caption}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <LegendDot fill={C.fg} label={companyName} ring={false} />
        <LegendDot fill={C.secondary} label={t('legend_account')} ring />
        <LegendDot fill={C.card} label={t('legend_counterparty')} ring />
        <LegendDot fill={C.secondary} label={t('legend_supplier')} ring small />
        <span>{t('legend_edge')}</span>
        {model.truncated && <span className="italic">{t('graph_truncated')}</span>}
      </div>

      {/* Screen-reader alternative: the same payload as a plain list. */}
      <ul className="sr-only">
        {model.payees.map((p) => (
          <li key={`sr:${p.id}`}>{payeeCaption(p.entity)}</li>
        ))}
      </ul>
    </div>
  )
}

function LegendDot({ fill, label, ring, small }: { fill: string; label: string; ring: boolean; small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block rounded-full"
        style={{
          width: small ? 8 : 10,
          height: small ? 8 : 10,
          background: fill,
          border: ring ? `1px solid ${C.fg}` : 'none',
        }}
      />
      <span className="max-w-[9rem] truncate">{label}</span>
    </span>
  )
}
