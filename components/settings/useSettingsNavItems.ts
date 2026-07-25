'use client'

import { useTranslations } from 'next-intl'
import { useCompany } from '@/contexts/CompanyContext'
import { useAgentSheet } from '@/components/agent/AgentSheetProvider'
import { ENABLED_EXTENSION_IDS } from '@/lib/extensions/_generated/enabled-extensions'

export type SettingsGroupKey = 'account' | 'company' | 'accounting' | 'sales' | 'tools'

export interface SettingsNavItem {
  id: string
  href: string
  label: string
  group: SettingsGroupKey
}

export interface SettingsNavGroup {
  key: SettingsGroupKey
  label: string
  items: SettingsNavItem[]
}

// Rail group order: personal first (Konto), then company-scoped buckets.
const GROUP_ORDER: SettingsGroupKey[] = ['account', 'company', 'accounting', 'sales', 'tools']

/**
 * Every route the sheet owns, keyed by section id. One source of truth for both
 * the nav items below and `isSheetSection`.
 */
const SECTION_HREFS = {
  account: '/settings/account',
  billing: '/settings/billing',
  company: '/settings/company',
  bookkeeping: '/settings/bookkeeping',
  tax: '/settings/tax',
  salary: '/settings/salary',
  invoicing: '/settings/invoicing',
  templates: '/settings/templates',
  banking: '/settings/banking',
  assistant: '/settings/assistant',
  api: '/settings/api',
} as const

/**
 * Whether `pathname` is a settings section the sheet owns. The cold-load sheet
 * (`@settingsModal/default.tsx`) and the settings layout both branch on this:
 * one draws the sheet, the other must then draw nothing in the panel, so they
 * cannot be allowed to disagree about a given URL. Everything else under
 * /settings (team, backup, skatteverket, company-profile) keeps the legacy page.
 *
 * Ownership is deliberately read off the full route list, not off the
 * visibility-filtered items: each of these paths has a stub page that renders
 * null, so a section hidden by a visibility rule but reached by deep link
 * (/settings/assistant before BankID verification, /settings/banking in a
 * sandbox, /settings/api without the MCP extension) would otherwise be claimed
 * by neither surface and leave the legacy shell wrapped around an empty panel.
 * Visibility decides what the sheet shows once open, not who draws the route.
 */
export function isSheetSection(pathname: string): boolean {
  return (
    pathname === '/settings' ||
    Object.values(SECTION_HREFS).some(
      (href) => pathname === href || pathname.startsWith(href + '/'),
    )
  )
}

/**
 * Single source of truth for the settings sections, their conditional
 * visibility, and their grouping. Consumed by both the full-page rail and the
 * routed settings modal so the two can never drift on which sections show for
 * AB vs EF, sandbox, identity-verified, or enabled extensions.
 *
 * Visibility is derived from client context (no extra fetch): `isSandbox`
 * comes from CompanyContext, identity from the agent sheet, and extension
 * availability from the generated enabled-extensions set.
 */
export function useSettingsNavItems(): { items: SettingsNavItem[]; groups: SettingsNavGroup[] } {
  const { company, isSandbox } = useCompany()
  const { identity } = useAgentSheet()
  const t = useTranslations('settings_nav')

  const hasCompany = !!company
  const hasBankingExtension = ENABLED_EXTENSION_IDS.has('enable-banking')
  const hasMcpExtension = ENABLED_EXTENSION_IDS.has('mcp-server')

  // Företagsprofil (TIC-snapshot) lives under Företag; Skatteverket under Skatt;
  // assistentens minne + kunskap under Assistenten; säkerhetsbackup under
  // Importera/Exportera. Team stays hidden (show:false) until enabled.
  const defs: Array<SettingsNavItem & { show: boolean }> = [
    { id: 'account', href: SECTION_HREFS.account, label: t('account'), group: 'account', show: true },
    { id: 'billing', href: SECTION_HREFS.billing, label: t('billing'), group: 'account', show: true },
    { id: 'company', href: SECTION_HREFS.company, label: t('company'), group: 'company', show: hasCompany },
    { id: 'bookkeeping', href: SECTION_HREFS.bookkeeping, label: t('bookkeeping'), group: 'accounting', show: hasCompany },
    { id: 'tax', href: SECTION_HREFS.tax, label: t('tax'), group: 'accounting', show: hasCompany },
    // Lön settings follow the sidebar: every aktiebolag, plus any company that
    // has registered as an employer (pays_salaries): e.g. an enskild firma
    // with staff. #782
    { id: 'salary', href: SECTION_HREFS.salary, label: t('salary'), group: 'accounting', show: hasCompany && (company?.entity_type === 'aktiebolag' || !!company?.pays_salaries) },
    { id: 'invoicing', href: SECTION_HREFS.invoicing, label: t('invoicing'), group: 'sales', show: hasCompany },
    { id: 'templates', href: SECTION_HREFS.templates, label: t('templates'), group: 'sales', show: hasCompany },
    { id: 'banking', href: SECTION_HREFS.banking, label: t('banking'), group: 'tools', show: hasCompany && !isSandbox && hasBankingExtension },
    { id: 'assistant', href: SECTION_HREFS.assistant, label: t('assistant'), group: 'tools', show: hasCompany && identity.isVerified },
    { id: 'api', href: SECTION_HREFS.api, label: t('api'), group: 'tools', show: hasCompany && hasMcpExtension },
  ]

  const items: SettingsNavItem[] = defs
    .filter((d) => d.show)
    .map(({ show: _show, ...item }) => item)

  const groupLabels: Record<SettingsGroupKey, string> = {
    account: t('group_account'),
    company: t('group_company'),
    accounting: t('group_accounting'),
    sales: t('group_sales'),
    tools: t('group_tools'),
  }

  const groups: SettingsNavGroup[] = GROUP_ORDER.map((key) => ({
    key,
    label: groupLabels[key],
    items: items.filter((i) => i.group === key),
  })).filter((g) => g.items.length > 0)

  return { items, groups }
}
