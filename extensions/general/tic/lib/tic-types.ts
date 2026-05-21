/** Search response wrapper (Typesense). v2 keeps the same hits/found shape. */
export interface TICCompanyResponse {
  facet_counts: unknown[]
  found: number
  hits: Array<{
    document: TICCompanyDocument
  }>
}

/**
 * Company document from the Typesense `/search-public/companies` index.
 *
 * v2 (Lens) added `isCeased: boolean` as a top-level boolean and changed
 * `activityStatus` from a free-form string to an enum
 * (`hasNeverBeenActive | isActive | isNoLongerActive | unknown`). Existing
 * fields we read are unchanged.
 */
export interface TICCompanyDocument {
  companyId: number
  registrationNumber: string
  names: Array<{
    nameOrIdentifier: string
    companyNamingType: string
    companyNameDecidedAt?: number
    firstSeenAt?: number
  }>
  legalEntityType: string
  registrationDate: number
  mostRecentPurpose?: string
  mostRecentRegisteredAddress?: {
    streetAddress?: string
    postalCode?: string
    city?: string
    countryCodeAlpha3?: string
  }
  isRegisteredForVAT?: boolean
  isRegisteredForFTax?: boolean
  isRegisteredForPayroll?: boolean
  isCeased?: boolean
  activityStatus?: string
  cSector?: {
    categoryCode: number
    categoryCodeDescription: string
  }
  cOwnership?: {
    categoryCode: number
    categoryCodeDescription: string
  }
  cNbrEmployeesInterval?: {
    categoryCode: number
    categoryCodeDescription: string
  }
  cTurnoverInterval?: {
    categoryCode: number
    categoryCodeDescription: string
  }
  mostRecentFinancialSummary?: {
    periodStart: number
    periodEnd: number
    isAudited?: boolean
    rs_NetSalesK?: number
    rs_OperatingProfitOrLossK?: number
    bs_TotalAssetsK?: number
    fn_NumberOfEmployees?: number
    km_OperatingMargin?: number
    km_NetProfitMargin?: number
    km_EquityAssetsRatio?: number
  }
}

/**
 * v2 `/companies/{id}/bank-accounts` returns only Bankgirot numbers
 * (`Bankgironumber_Dto[]`), not full bank accounts. v1's IBAN / plusgiro
 * / generic bank-account coverage is gone from this endpoint.
 */
export interface TICBankgirot {
  bankgironumber?: number | null
  terminated?: boolean | null
  name?: string | null
  isTaxBankgironumber?: boolean | null
  updatedAt?: string | null
}

/** v2 `/companies/{id}/industries` returns `CompanyIndustryCode_Dto[]`. */
export interface TICIndustryCode {
  companyIndustryCodeType?: 'sni2007' | 'sni2025' | 'other' | string
  industryCode?: string | null
  description?: string | null
  rank?: number | null
}

/** v2 `/companies/{id}/email-addresses` returns `View_CompanyEmail[]`. */
export interface TICEmail {
  emailAddress?: string | null
  firstSeenAtUtc?: string | null
  lastSeenAtUtc?: string | null
}

/** v2 `/companies/{id}/phone-numbers` returns `CompanyPhoneNumber_Dto[]`. */
export interface TICPhone {
  phoneNumberFormatted?: string | null
  e164PhoneNumber?: string | null
  firstSeenAtUtc?: string | null
  lastSeenAtUtc?: string | null
}

/** v2 `/companies/{id}/purposes` returns `CompanyPurpose_Dto[]`. */
export interface TICCompanyPurpose {
  companyPurposeId?: number
  purpose?: string
  firstSeenAtUtc?: string
  lastUpdatedAtUtc?: string
}

/**
 * Document type enum from v2 `/companies/{id}/documents`. The endpoint
 * returns every document the company has filed (annual reports, audit
 * reports, articles of association, minutes, etc.); we filter on this
 * field to extract the financial-report subset that TicWorkspace shows.
 */
export type TICDocumentType =
  | 'annualReport'
  | 'interimReport'
  | 'auditReport'
  | 'articlesOfAssociation'
  | 'economicPlan'
  | 'certificateOfApproval'
  | 'minutes'
  | 'statutes'
  | 'receivedButNotRegistered'
  | 'receivedButTerminated'
  | 'other'

/**
 * v2 `/companies/{id}/documents` row. The metadata that used to live as
 * flat fields on v1's `/financial-report-summaries` rows now lives nested
 * under `financialReportMetadata`. Files are fetched separately via
 * `/documents/{id}` using the FRF_-prefixed `id`.
 */
export interface TICDocument {
  id?: string | null
  type?: TICDocumentType | string
  financialReportMetadata?: {
    arrivalDate?: string | null
    registrationDate?: string | null
    periodStart?: string | null
    periodEnd?: string | null
    isInterimReport?: boolean | null
    isConsolidatedAccounts?: boolean | null
    auditor?: string | null
    auditorFullName?: string | null
    auditCompanyName?: string | null
  }
}

/**
 * Normalized financial-report row consumed by TicWorkspace. v1's TIC
 * endpoint returned this shape directly; in v2 we derive it from
 * `TICDocument` (filtered to `type === 'annualReport'`). Keeping the
 * shape stable means TicWorkspace doesn't need to change.
 */
export interface TICFinancialReportSummary {
  financialReportSummaryId?: number
  title?: string
  arrivalDate?: string
  registrationDate?: string
  periodStart?: string
  periodEnd?: string
  isInterimReport?: boolean
  isConsolidatedAccounts?: boolean
  isAudited?: boolean
  auditOpinion?: string
}

/** Normalized company profile for workspace display */
export interface TICCompanyProfile {
  companyId: number
  orgNumber: string
  companyName: string
  legalEntityType: string
  registrationDate: number
  activityStatus: string | null
  purpose: string | null
  address: { street: string | null; postalCode: string | null; city: string | null } | null
  registration: { fTax: boolean; vat: boolean; payroll: boolean }
  sector: { code: number; description: string } | null
  employeeRange: string | null
  turnoverRange: string | null
  email: string | null
  phone: string | null
  sniCodes: { code: string; name: string }[]
  bankAccounts: { type: string; accountNumber: string; bic: string | null }[]
  financials: {
    periodStart: number
    periodEnd: number
    netSalesK: number | null
    operatingProfitK: number | null
    totalAssetsK: number | null
    numberOfEmployees: number | null
    operatingMargin: number | null
    netProfitMargin: number | null
    equityAssetsRatio: number | null
  } | null
  financialReports: TICFinancialReportSummary[]
  fetchedAt: string
}

export class TICAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message)
    this.name = 'TICAPIError'
  }
}
