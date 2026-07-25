'use client'

import type { ComponentType } from 'react'
import dynamic from 'next/dynamic'
import { ENABLED_EXTENSION_IDS } from '@/lib/extensions/_generated/enabled-extensions'
import { SettingsLoadingSkeleton } from '../SettingsLoadingSkeleton'

/**
 * Per-section subsection registry for the settings sheet's accordion
 * (Dragspelet). Each entry becomes one accordion panel; sections without an
 * entry here fall back to rendering their full legacy section component as a
 * single flow (SETTINGS_SECTIONS in ../sections). Decompose a section by
 * adding it here: the accordion, the search index and the deep links all
 * follow automatically.
 *
 * `titleKey` resolves in the `settings_sheet` namespace. `keywords` feed the
 * settings search (Swedish terms: search matches these plus the localized
 * titles).
 */

export interface SheetSubsectionContext {
  isAktiebolag: boolean
  isSandbox: boolean
  /** Company role of the signed-in user; null when no active company. */
  role: string | null
}

export interface SheetSubsection {
  id: string
  titleKey: string
  keywords?: string[]
  /** Approximate number of individual settings in the panel, shown muted on
   *  the accordion header ("N inställningar"). Purely informational scent. */
  fieldCount?: number
  show?: (ctx: SheetSubsectionContext) => boolean
  Component: ComponentType
}

function lazy(loader: () => Promise<{ default: ComponentType }>): ComponentType {
  return dynamic(loader, { loading: SettingsLoadingSkeleton })
}

const BookkeepingFramework = lazy(() =>
  import('../sections/BookkeepingSubsections').then((m) => ({ default: m.BookkeepingFrameworkSettings })),
)
const BookkeepingMethod = lazy(() =>
  import('../sections/BookkeepingSubsections').then((m) => ({ default: m.BookkeepingMethodSettings })),
)
const BookkeepingSeriesMap = lazy(() =>
  import('../sections/BookkeepingSubsections').then((m) => ({ default: m.BookkeepingSeriesMapSettings })),
)
const BookkeepingSeries = lazy(() =>
  import('../sections/BookkeepingSubsections').then((m) => ({ default: m.BookkeepingSeriesStatus })),
)
const BookkeepingAutomation = lazy(() =>
  import('../sections/BookkeepingSubsections').then((m) => ({ default: m.BookkeepingAutomationSettings })),
)
const BookkeepingRelated = lazy(() =>
  import('../sections/BookkeepingSubsections').then((m) => ({ default: m.BookkeepingRelatedLinks })),
)
const FiscalYears = lazy(() =>
  import('../FiscalYearsManager').then((m) => ({ default: m.FiscalYearsManager })),
)

const CompanyInfo = lazy(() =>
  import('../sections/CompanySubsections').then((m) => ({ default: m.CompanyInfoSettings })),
)
const CompanyLogo = lazy(() =>
  import('../sections/CompanySubsections').then((m) => ({ default: m.CompanyLogoSettings })),
)
const CompanyMembers = lazy(() =>
  import('../CompanyMembersSection').then((m) => ({ default: m.CompanyMembersSection })),
)
const CompanyFiscalPeriod = lazy(() =>
  import('../FiscalPeriodEditor').then((m) => ({ default: m.FiscalPeriodEditor })),
)
const CompanyProfile = lazy(() =>
  import('../CompanyProfileSection').then((m) => ({ default: m.CompanyProfileSection })),
)
const CompanyDanger = lazy(() =>
  import('../CompanyDangerZone').then((m) => ({ default: m.CompanyDangerZone })),
)
const AccountName = lazy(() =>
  import('../sections/AccountSubsections').then((m) => ({ default: m.AccountNameSettings })),
)
const AccountAppearance = lazy(() =>
  import('../sections/AccountSubsections').then((m) => ({ default: m.AccountAppearanceSettings })),
)
const AccountInstallApp = lazy(() =>
  import('../InstallAppSection').then((m) => ({ default: m.InstallAppSection })),
)
const AccountSecurity = lazy(() =>
  import('../SecuritySettings').then((m) => ({ default: m.SecuritySettings })),
)
const AccountCalendar = lazy(() =>
  import('../CalendarFeedSettings').then((m) => ({ default: m.CalendarFeedSettings })),
)
const AccountLogout = lazy(() =>
  import('../sections/AccountSubsections').then((m) => ({ default: m.AccountLogoutSettings })),
)
const AccountLegal = lazy(() =>
  import('../sections/AccountSubsections').then((m) => ({ default: m.AccountLegalLinks })),
)
const AccountDanger = lazy(() =>
  import('../sections/AccountSubsections').then((m) => ({ default: m.AccountDangerSettings })),
)

const TaxSkatteverket = lazy(() =>
  import('../sections/TaxSubsections').then((m) => ({ default: m.TaxSkatteverketConnectionSettings })),
)
const TaxDetails = lazy(() =>
  import('../sections/TaxSubsections').then((m) => ({ default: m.TaxDetailsSettings })),
)
const TaxNotices = lazy(() =>
  import('../TaxAssessmentNoticesPanel').then((m) => ({ default: m.TaxAssessmentNoticesPanel })),
)
const InvoicingPreview = lazy(() =>
  import('../sections/InvoicingSubsections').then((m) => ({ default: m.InvoicingPreviewSettings })),
)
const InvoicingAccounts = lazy(() =>
  import('../sections/InvoicingSubsections').then((m) => ({ default: m.InvoicingPaymentAccountsSettings })),
)
const InvoicingGeneral = lazy(() =>
  import('../sections/InvoicingSubsections').then((m) => ({ default: m.InvoicingGeneralSettings })),
)
const InvoicingPaymentLink = lazy(() =>
  import('../sections/InvoicingSubsections').then((m) => ({ default: m.InvoicingPaymentLinkSettings })),
)
const InvoicingPdf = lazy(() =>
  import('../sections/InvoicingSubsections').then((m) => ({ default: m.InvoicingPdfPrintSettings })),
)
const InvoicingRecipients = lazy(() =>
  import('../sections/InvoicingSubsections').then((m) => ({ default: m.InvoicingEmailRecipientsSettings })),
)
const InvoicingEmailTexts = lazy(() =>
  import('../sections/InvoicingSubsections').then((m) => ({ default: m.InvoicingEmailTextsSettings })),
)
const BookingTemplates = lazy(() =>
  import('../BookingTemplatesPanel').then((m) => ({ default: m.BookingTemplatesPanel })),
)
const CounterpartyTemplates = lazy(() =>
  import('../CounterpartyTemplatesPanel').then((m) => ({ default: m.CounterpartyTemplatesPanel })),
)

const ApiKeys = lazy(() =>
  import('../sections/ApiSubsections').then((m) => ({ default: m.ApiKeysSettings })),
)
const ApiOAuthClients = lazy(() =>
  import('../sections/ApiSubsections').then((m) => ({ default: m.ApiOAuthClientsSettings })),
)
const AssistantKnowledge = lazy(() =>
  import('../sections/AssistantSubsections').then((m) => ({ default: m.AssistantKnowledgeSettings })),
)
const AssistantMemory = lazy(() =>
  import('../sections/AssistantSubsections').then((m) => ({ default: m.AssistantMemorySettings })),
)
const AssistantSkills = lazy(() =>
  import('../sections/AssistantSubsections').then((m) => ({ default: m.AssistantSkillsSettings })),
)
const AssistantFab = lazy(() =>
  import('../sections/AssistantSubsections').then((m) => ({ default: m.AssistantFabVisibilitySettings })),
)
const BankingContent = lazy(() =>
  import('../sections/BankingSettingsContent').then((m) => ({ default: m.BankingSettingsContent })),
)
const BillingContent = lazy(() =>
  import('../sections/BillingSettingsContent').then((m) => ({ default: m.BillingSettingsContent })),
)

const SalaryPayment = lazy(() =>
  import('../sections/SalarySubsections').then((m) => ({ default: m.SalaryPaymentSettings })),
)
const SalaryTaxTables = lazy(() =>
  import('../sections/SalarySubsections').then((m) => ({ default: m.SalaryTaxTables })),
)
const SalaryVacation = lazy(() =>
  import('../sections/SalarySubsections').then((m) => ({ default: m.SalaryVacationInfo })),
)
const SalaryInfo = lazy(() =>
  import('../sections/SalarySubsections').then((m) => ({ default: m.SalaryInfoNotes })),
)

export const SETTINGS_SUBSECTIONS: Partial<Record<string, SheetSubsection[]>> = {
  account: [
    {
      id: 'name',
      titleKey: 'sub_account_name',
      keywords: ['namn', 'visningsnamn', 'profil'],
      fieldCount: 1,
      Component: AccountName,
    },
    {
      id: 'appearance',
      titleKey: 'sub_account_appearance',
      keywords: ['tema', 'mörkt läge', 'ljust läge', 'språk', 'svenska', 'engelska'],
      fieldCount: 2,
      Component: AccountAppearance,
    },
    {
      id: 'install-app',
      titleKey: 'sub_account_install',
      keywords: ['installera', 'app', 'pwa', 'hemskärm'],
      fieldCount: 1,
      Component: AccountInstallApp,
    },
    {
      id: 'security',
      titleKey: 'sub_account_security',
      keywords: ['lösenord', 'tvåfaktorsautentisering', '2fa', 'bankid', 'säkerhet'],
      fieldCount: 4,
      Component: AccountSecurity,
    },
    {
      id: 'calendar',
      titleKey: 'sub_account_calendar',
      keywords: ['kalender', 'ical', 'prenumeration', 'webcal', 'deadlines'],
      fieldCount: 3,
      show: () => ENABLED_EXTENSION_IDS.has('calendar'),
      Component: AccountCalendar,
    },
    {
      id: 'logout',
      titleKey: 'sub_account_logout',
      keywords: ['logga ut', 'utloggning', 'avsluta session'],
      fieldCount: 1,
      Component: AccountLogout,
    },
    {
      id: 'legal',
      titleKey: 'sub_account_legal',
      keywords: ['integritetspolicy', 'personuppgiftsbiträdesavtal', 'dpa', 'avtal', 'sekretess'],
      fieldCount: 2,
      Component: AccountLegal,
    },
    {
      id: 'delete-account',
      titleKey: 'sub_account_danger',
      keywords: ['ta bort konto', 'radera konto', 'avsluta'],
      fieldCount: 1,
      show: (ctx) => !ctx.isSandbox,
      Component: AccountDanger,
    },
  ],
  company: [
    {
      id: 'company-info',
      titleKey: 'sub_company_info',
      keywords: ['företagsnamn', 'organisationsnummer', 'adress', 'kontaktuppgifter', 'aktiekapital', 'antal aktier'],
      fieldCount: 10,
      Component: CompanyInfo,
    },
    {
      id: 'logo',
      titleKey: 'sub_company_logo',
      keywords: ['logotyp', 'logga', 'faktura', 'varumärke', 'uppladdning'],
      fieldCount: 1,
      Component: CompanyLogo,
    },
    {
      id: 'members',
      titleKey: 'sub_company_members',
      keywords: ['medlemmar', 'användare', 'bjud in', 'roller', 'behörighet'],
      fieldCount: 1,
      Component: CompanyMembers,
    },
    {
      id: 'first-fiscal-period',
      titleKey: 'sub_company_fiscal_period',
      keywords: ['räkenskapsår', 'startdatum', 'brutet räkenskapsår', 'period'],
      fieldCount: 3,
      show: (ctx) => ctx.role === 'owner' || ctx.role === 'admin',
      Component: CompanyFiscalPeriod,
    },
    {
      id: 'company-profile',
      titleKey: 'sub_company_profile',
      keywords: ['bolagsverket', 'bolagsuppgifter', 'snapshot', 'hämta', 'sni'],
      fieldCount: 2,
      Component: CompanyProfile,
    },
    {
      id: 'danger-zone',
      titleKey: 'sub_company_danger',
      keywords: ['ta bort', 'radera', 'arkivera'],
      fieldCount: 1,
      show: (ctx) => ctx.role === 'owner',
      Component: CompanyDanger,
    },
  ],
  bookkeeping: [
    {
      id: 'framework',
      titleKey: 'sub_bookkeeping_framework',
      keywords: ['k2', 'k3', 'regelverk', 'redovisning'],
      fieldCount: 1,
      show: (ctx) => ctx.isAktiebolag,
      Component: BookkeepingFramework,
    },
    {
      id: 'method',
      titleKey: 'sub_bookkeeping_method',
      keywords: [
        'bokföringsmetod', 'kontantmetoden', 'faktureringsmetoden',
        'standardserie', 'periodlåsning', 'låst', 'lås', 'automatisk låsning',
      ],
      fieldCount: 5,
      Component: BookkeepingMethod,
    },
    {
      id: 'fiscal-years',
      titleKey: 'sub_bookkeeping_fiscal_years',
      keywords: ['räkenskapsår', 'period', 'lås', 'stängt', 'öppet', 'bokslut'],
      fieldCount: 1,
      Component: FiscalYears,
    },
    {
      id: 'series-map',
      titleKey: 'sub_bookkeeping_series_map',
      keywords: ['verifikationsserie', 'serie', 'verifikat', 'nummerserie'],
      fieldCount: 14,
      Component: BookkeepingSeriesMap,
    },
    {
      id: 'series',
      titleKey: 'sub_bookkeeping_series_status',
      keywords: ['verifikationsserie', 'löpnummer', 'senaste nummer'],
      fieldCount: 1,
      Component: BookkeepingSeries,
    },
    {
      id: 'automation',
      titleKey: 'sub_bookkeeping_automation',
      keywords: ['periodisering', 'dimensioner', 'kostnadsställen', 'projekt'],
      fieldCount: 2,
      Component: BookkeepingAutomation,
    },
    {
      id: 'related',
      titleKey: 'sub_bookkeeping_related',
      keywords: ['kontoplan', 'bas'],
      fieldCount: 1,
      Component: BookkeepingRelated,
    },
  ],
  salary: [
    {
      id: 'payment',
      titleKey: 'sub_salary_payment',
      keywords: [
        'utbetalningsdag', 'lön', 'betalfil', 'pain001', 'iso20022',
        'bankgiro', 'bank', 'verifikationsserie',
      ],
      fieldCount: 4,
      Component: SalaryPayment,
    },
    {
      id: 'tax-tables',
      titleKey: 'sub_salary_tax_tables',
      keywords: ['skattetabell', 'skatteavdrag', 'preliminärskatt'],
      fieldCount: 1,
      Component: SalaryTaxTables,
    },
    {
      id: 'vacation',
      titleKey: 'sub_salary_vacation',
      keywords: ['semester', 'semesterlön', 'anställda'],
      fieldCount: 1,
      Component: SalaryVacation,
    },
    {
      id: 'info',
      titleKey: 'sub_salary_info',
      keywords: ['agi', 'arbetsgivardeklaration'],
      fieldCount: 1,
      Component: SalaryInfo,
    },
  ],
  tax: [
    {
      id: 'skatteverket',
      titleKey: 'sub_tax_skatteverket',
      keywords: ['skatteverket', 'anslutning', 'ombud', 'deklaration', 'skattekonto', 'koppla'],
      fieldCount: 2,
      // Same gate as the panel's own self-guard: hide the accordion row
      // entirely when the extension is off or the company is a sandbox, so no
      // empty panel row ever shows.
      show: (ctx) => ENABLED_EXTENSION_IDS.has('skatteverket') && !ctx.isSandbox,
      Component: TaxSkatteverket,
    },
    {
      id: 'details',
      titleKey: 'sub_tax_details',
      keywords: ['moms', 'f-skatt', 'arbetsgivare', 'momsperiod', 'preliminärskatt', 'räkenskapsår', 'eu', 'oss', 'kontrolluppgifter', 'rot', 'rut'],
      fieldCount: 22,
      Component: TaxDetails,
    },
    {
      id: 'assessment-notices',
      titleKey: 'sub_tax_notices',
      keywords: ['slutskattebesked', 'kvarskatt', 'omprövning', 'betalningsdatum', 'beslut'],
      fieldCount: 1,
      Component: TaxNotices,
    },
  ],
  invoicing: [
    {
      id: 'preview',
      titleKey: 'sub_invoicing_preview',
      keywords: ['förhandsvisning', 'faktura', 'utseende', 'exempel'],
      Component: InvoicingPreview,
    },
    {
      id: 'payment-accounts',
      titleKey: 'sub_invoicing_accounts',
      keywords: ['bankgiro', 'plusgiro', 'iban', 'valuta', 'betalningskonto', 'swift', 'swish'],
      fieldCount: 8,
      Component: InvoicingAccounts,
    },
    {
      id: 'defaults',
      titleKey: 'sub_invoicing_defaults',
      keywords: ['fakturanummer', 'prefix', 'betalningsvillkor', 'påminnelse', 'referens', 'förfallodagar'],
      fieldCount: 8,
      Component: InvoicingGeneral,
    },
    {
      id: 'payment-link',
      titleKey: 'sub_invoicing_payment_link',
      keywords: ['betalningslänk', 'stripe', 'kortbetalning', 'länk'],
      fieldCount: 1,
      Component: InvoicingPaymentLink,
    },
    {
      id: 'pdf',
      titleKey: 'sub_invoicing_pdf',
      keywords: ['pdf', 'utskrift', 'logotyp', 'typsnitt', 'ocr', 'öresavrundning', 'dröjsmålsränta'],
      fieldCount: 10,
      Component: InvoicingPdf,
    },
    {
      id: 'email-recipients',
      titleKey: 'sub_invoicing_recipients',
      keywords: ['mottagare', 'kopia', 'cc', 'bcc', 'e-post', 'utskick'],
      fieldCount: 2,
      Component: InvoicingRecipients,
    },
    {
      id: 'email-texts',
      titleKey: 'sub_invoicing_email_texts',
      keywords: ['e-posttext', 'ämnesrad', 'hälsning', 'mejltext', 'standardtext'],
      fieldCount: 8,
      Component: InvoicingEmailTexts,
    },
  ],
  templates: [
    {
      id: 'booking-templates',
      titleKey: 'sub_templates_booking',
      keywords: ['bokföringsmall', 'mall', 'kontering', 'transaktion', 'standardmall'],
      fieldCount: 1,
      Component: BookingTemplates,
    },
    {
      id: 'counterparty-templates',
      titleKey: 'sub_templates_counterparty',
      keywords: ['motpart', 'inlärda mönster', 'sie-import', 'automatisk kontering', 'förslag'],
      fieldCount: 1,
      Component: CounterpartyTemplates,
    },
  ],
  api: [
    {
      id: 'api-keys',
      titleKey: 'sub_api_keys',
      keywords: ['api-nyckel', 'nyckel', 'mcp', 'claude', 'integration', 'token'],
      fieldCount: 2,
      Component: ApiKeys,
    },
    {
      id: 'oauth-clients',
      titleKey: 'sub_api_oauth',
      keywords: ['oauth', 'klient', 'app', 'integration', 'behörighet'],
      fieldCount: 1,
      Component: ApiOAuthClients,
    },
  ],
  assistant: [
    {
      id: 'knowledge',
      titleKey: 'sub_assistant_knowledge',
      keywords: ['kunskap', 'konteringskarta', 'agent', 'assistent'],
      fieldCount: 1,
      Component: AssistantKnowledge,
    },
    {
      id: 'memory',
      titleKey: 'sub_assistant_memory',
      keywords: ['minne', 'assistent', 'kom ihåg', 'fakta', 'agent'],
      fieldCount: 1,
      Component: AssistantMemory,
    },
    {
      id: 'skills',
      titleKey: 'sub_assistant_skills',
      keywords: ['kompetens', 'färdigheter', 'assistent'],
      fieldCount: 1,
      Component: AssistantSkills,
    },
    {
      id: 'fab',
      titleKey: 'sub_assistant_button',
      keywords: ['assistentknapp', 'flytande knapp', 'visa', 'dölj', 'chattknapp'],
      fieldCount: 1,
      Component: AssistantFab,
    },
  ],
  banking: [
    {
      id: 'connection',
      titleKey: 'sub_banking_connection',
      keywords: ['bank', 'bankkoppling', 'synk', 'psd2', 'enable banking', 'konton'],
      fieldCount: 2,
      Component: BankingContent,
    },
  ],
  billing: [
    {
      id: 'subscription',
      titleKey: 'sub_billing_subscription',
      keywords: ['abonnemang', 'betalning', 'prenumeration', 'provperiod', 'stripe'],
      fieldCount: 2,
      Component: BillingContent,
    },
  ],
}
