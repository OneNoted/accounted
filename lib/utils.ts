import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format as formatDateFns, parseISO } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency: string = 'SEK'): string {
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(date: Date | string): string {
  // parseISO interprets bare 'yyyy-MM-dd' as local midnight, not UTC midnight.
  // Using new Date() would shift the displayed day by one in timezones west of
  // UTC for bare date strings — that's an off-by-one we don't want for
  // accounting data.
  const d = typeof date === 'string' ? parseISO(date) : date
  return formatDateFns(d, 'yyyy-MM-dd')
}

/**
 * Long-form Swedish date for metadata/audit contexts (e.g. "9 maj 2026").
 * Use formatDate for transaction/voucher/invoice dates that need to align in tables.
 */
export function formatDateLong(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return d.toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatOrgNumber(orgNumber: string): string {
  // Format Swedish org number: XXXXXX-XXXX
  const cleaned = orgNumber.replace(/\D/g, '')
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 6)}-${cleaned.slice(6)}`
  }
  return orgNumber
}

/**
 * Returns the display name for a company, using trade name as primary
 * with legal name in parentheses if both exist.
 */
export function getCompanyDisplayName(settings: { trade_name?: string | null; company_name?: string | null }): string {
  const tradeName = settings.trade_name?.trim()
  const legalName = settings.company_name?.trim()
  if (tradeName && legalName) {
    return `${tradeName} (${legalName})`
  }
  return legalName || tradeName || ''
}

/**
 * Returns just the primary name for contexts where a short name is needed
 * (e.g. email from name). Uses trade name if set, otherwise legal name.
 */
export function getCompanyPrimaryName(settings: { trade_name?: string | null; company_name?: string | null }): string {
  return settings.trade_name?.trim() || settings.company_name?.trim() || ''
}

export function generateInvoiceNumber(): string {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  return `${year}-${random}`
}
