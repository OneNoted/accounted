import type { CompanySettings } from '@/types'

/**
 * Return the ISO date (YYYY-MM-DD) for the start of the fiscal year that
 * contains `today`, given the company's fiscal_year_start_month setting.
 *
 * Enskild firma is locked to calendar year per BFL.
 */
export function getCurrentFiscalYearStart(
  settings: Pick<CompanySettings, 'fiscal_year_start_month' | 'entity_type'> | null | undefined,
  today: Date = new Date(),
): string {
  let startMonth = settings?.fiscal_year_start_month || 1
  if (settings?.entity_type === 'enskild_firma') startMonth = 1

  const year = today.getMonth() + 1 >= startMonth ? today.getFullYear() : today.getFullYear() - 1
  return `${year}-${String(startMonth).padStart(2, '0')}-01`
}

/**
 * Return the ISO date for the start of the PREVIOUS fiscal year — useful when
 * the user wants to backfill the year that just closed.
 */
export function getPreviousFiscalYearStart(
  settings: Pick<CompanySettings, 'fiscal_year_start_month' | 'entity_type'> | null | undefined,
  today: Date = new Date(),
): string {
  let startMonth = settings?.fiscal_year_start_month || 1
  if (settings?.entity_type === 'enskild_firma') startMonth = 1

  const currentYearStart = today.getMonth() + 1 >= startMonth
    ? today.getFullYear()
    : today.getFullYear() - 1
  return `${currentYearStart - 1}-${String(startMonth).padStart(2, '0')}-01`
}

export function daysBetween(from: string | Date, to: string | Date = new Date()): number {
  const fromDate = typeof from === 'string' ? new Date(from) : from
  const toDate = typeof to === 'string' ? new Date(to) : to
  const diff = toDate.getTime() - fromDate.getTime()
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}
