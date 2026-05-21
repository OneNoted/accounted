import type {
  TICCompanyResponse,
  TICCompanyDocument,
  TICBankgirot,
  TICIndustryCode,
  TICEmail,
  TICPhone,
  TICCompanyPurpose,
  TICDocument,
} from './tic-types'
import { TICAPIError } from './tic-types'

const TIC_API_TIMEOUT = 15_000

/**
 * Generic TIC API fetch helper.
 *
 * Routes through the proxy at TIC_API_PROXY_URL (no API key needed in this
 * codebase). The proxy targets `lens-api.tic.io` (v2 "Lens API") and adds
 * `x-api-key` server-side. v1 (`api.tic.io`) is retired — all paths below
 * are Lens paths (no `/datasets/` prefix, `id` instead of `companyId`).
 */
export async function ticApiFetch<T>(endpoint: string): Promise<T | null> {
  const proxyUrl = process.env.TIC_API_PROXY_URL
  if (!proxyUrl) {
    throw new TICAPIError('TIC_API_PROXY_URL is not configured', undefined, 'NOT_CONFIGURED')
  }

  const url = `${proxyUrl}?endpoint=${encodeURIComponent(endpoint)}`

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIC_API_TIMEOUT),
    })

    if (response.status === 404) {
      return null
    }

    if (response.status === 429) {
      throw new TICAPIError('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED')
    }

    if (!response.ok) {
      throw new TICAPIError(`TIC API error: ${response.statusText}`, response.status)
    }

    return await response.json()
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new TICAPIError('Request timeout', undefined, 'TIMEOUT')
    }
    if (error instanceof TICAPIError) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new TICAPIError(`Failed to fetch from TIC: ${message}`)
  }
}

/** Search for a company by org number. Returns the first matching document or null. */
export async function searchCompanyByOrgNumber(
  orgNumber: string
): Promise<TICCompanyDocument | null> {
  const cleaned = orgNumber.replace(/[\s-]/g, '')
  const data = await ticApiFetch<TICCompanyResponse>(
    `/search-public/companies?q=${cleaned}&query_by=registrationNumber`
  )

  if (!data || data.found === 0 || !data.hits?.[0]) {
    return null
  }

  return data.hits[0].document
}

/**
 * Get bank accounts for a company. v2 narrows this endpoint to Bankgirot
 * numbers only (returns `Bankgironumber_Dto[]`); v1's IBAN / plusgiro
 * coverage is no longer available from this path.
 */
export async function getBankAccounts(companyId: number): Promise<TICBankgirot[] | null> {
  return ticApiFetch<TICBankgirot[]>(`/companies/${companyId}/bank-accounts`)
}

/**
 * Get industry codes for a company. v2 returns a discriminated array
 * (`CompanyIndustryCode_Dto[]`) covering both SNI 2007 and SNI 2025;
 * callers filter by `companyIndustryCodeType` for the version they want.
 */
export async function getIndustryCodes(companyId: number): Promise<TICIndustryCode[] | null> {
  return ticApiFetch<TICIndustryCode[]>(`/companies/${companyId}/industries`)
}

/** Get email addresses for a company. */
export async function getEmails(companyId: number): Promise<TICEmail[] | null> {
  return ticApiFetch<TICEmail[]>(`/companies/${companyId}/email-addresses`)
}

/** Get phone numbers for a company. */
export async function getPhones(companyId: number): Promise<TICPhone[] | null> {
  return ticApiFetch<TICPhone[]>(`/companies/${companyId}/phone-numbers`)
}

/** Get company purpose / verksamhetsbeskrivning. */
export async function getCompanyPurpose(companyId: number): Promise<TICCompanyPurpose[] | null> {
  return ticApiFetch<TICCompanyPurpose[]>(`/companies/${companyId}/purposes`)
}

/**
 * List all documents filed by the company (annual reports, audit reports,
 * articles of association, minutes, etc.). v2 replaces v1's
 * `/financial-report-summaries` with this broader endpoint. Filter the
 * result by `type === 'annualReport'` to recover the financial-report
 * subset.
 */
export async function getCompanyDocuments(companyId: number): Promise<TICDocument[] | null> {
  return ticApiFetch<TICDocument[]>(`/companies/${companyId}/documents`)
}
