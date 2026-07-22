import type {
  CompanySettings,
  Currency,
  InvoicePaymentAccount,
} from '@/types'

export const INVOICE_PAYMENT_ACCOUNT_CURRENCIES: readonly Currency[] = [
  'SEK',
  'EUR',
  'USD',
  'GBP',
  'NOK',
  'DKK',
]

const PAYMENT_FIELDS: readonly (keyof InvoicePaymentAccount)[] = [
  'bank_name',
  'clearing_number',
  'account_number',
  'bankgiro',
  'plusgiro',
  'swish',
  'iban',
  'bic',
]

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function legacySekInvoicePaymentAccount(
  company: CompanySettings,
): InvoicePaymentAccount {
  return {
    bank_name: clean(company.bank_name),
    clearing_number: clean(company.clearing_number),
    account_number: clean(company.account_number),
    bankgiro: clean(company.bankgiro),
    plusgiro: clean(company.plusgiro),
    swish: clean(company.swish),
    iban: clean(company.iban),
    bic: clean(company.bic),
  }
}

export function normalizeInvoicePaymentAccount(
  account: Partial<InvoicePaymentAccount>,
): InvoicePaymentAccount {
  return {
    bank_name: clean(account.bank_name),
    clearing_number: clean(account.clearing_number),
    account_number: clean(account.account_number),
    bankgiro: clean(account.bankgiro),
    plusgiro: clean(account.plusgiro),
    swish: clean(account.swish),
    iban: clean(account.iban)?.replace(/\s/g, '').toUpperCase() ?? null,
    bic: clean(account.bic)?.replace(/\s/g, '').toUpperCase() ?? null,
  }
}

export function resolveInvoicePaymentAccount(
  company: CompanySettings,
  currency: Currency,
): InvoicePaymentAccount | null {
  const configured = company.invoice_payment_accounts?.[currency]
  if (configured) return normalizeInvoicePaymentAccount(configured)
  return currency === 'SEK' ? legacySekInvoicePaymentAccount(company) : null
}

export function hasUsableInvoicePaymentAccount(
  account: InvoicePaymentAccount | null,
  currency: Currency,
): boolean {
  if (!account) return false
  if (currency !== 'SEK') return !!account.iban
  return !!(
    account.iban
    || account.bankgiro
    || account.plusgiro
    || account.swish
    || (account.clearing_number && account.account_number)
  )
}

/**
 * Return invoice render settings with only the matching payment account.
 * Foreign invoices never inherit the legacy SEK payment details.
 */
export function companyWithInvoicePaymentAccount(
  company: CompanySettings,
  currency: Currency,
): CompanySettings {
  const account = resolveInvoicePaymentAccount(company, currency)
  const updates = Object.fromEntries(
    PAYMENT_FIELDS.map((field) => [field, account?.[field] ?? null]),
  ) as Pick<CompanySettings, keyof InvoicePaymentAccount>
  return { ...company, ...updates }
}
