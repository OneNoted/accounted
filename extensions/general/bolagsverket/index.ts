import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Extension, ExtensionContext } from '@/lib/extensions/types'
import { createServiceClientNoCookies } from '@/lib/auth/api-keys'
import { BolagsverketClient, BolagsverketApiError, configFromEnv } from './lib/client'
import {
  applyHandelse,
  handleWebhook,
  normalizeOrgnr,
  submitArsredovisning,
} from './lib/submission-service'
import type { BolagsverketEnvironment, HandelseMeddelande } from './types'

/**
 * Bolagsverket integration — digital inlämning av årsredovisning.
 *
 * Generates iXBRL in core (lib/bokslut/ixbrl — works without this extension),
 * and adds the Bolagsverket leg: grunduppgifter prefill, kontrollera,
 * inlämning till eget utrymme, händelseprenumerationer + webhook receiver.
 *
 * Requires an avtal with Bolagsverket and an Expisoft/Steria
 * organisationscertifikat for acceptans/produktion (ANSLUTNINGSANVISNING
 * §5–6). The static test environment (BOLAGSVERKET_ENV=test) runs without a
 * certificate but needs a firewall opening (orgnr 1234567890/1234567891).
 *
 * Environment variables:
 * - BOLAGSVERKET_ENV          test | accept | prod (default test)
 * - BOLAGSVERKET_CLIENT_CERT  PEM (or base64-PEM) organisationscertifikat
 * - BOLAGSVERKET_CLIENT_KEY   PEM (or base64-PEM) private key
 * - BOLAGSVERKET_CA           optional extra CA chain
 *
 * Self-hosted installs may instead store `environment`, `client_cert_pem`,
 * `client_key_pem` in extension settings — or skip this extension entirely
 * and file manually with the downloaded .xhtml.
 */

const SETTINGS_KEYS = {
  environment: 'environment',
  certPem: 'client_cert_pem',
  keyPem: 'client_key_pem',
} as const

async function clientFor(ctx: ExtensionContext): Promise<BolagsverketClient> {
  const [environment, certPem, keyPem] = await Promise.all([
    ctx.settings.get<string>(SETTINGS_KEYS.environment),
    ctx.settings.get<string>(SETTINGS_KEYS.certPem),
    ctx.settings.get<string>(SETTINGS_KEYS.keyPem),
  ])
  return new BolagsverketClient(
    configFromEnv({
      ...(environment ? { environment: environment as BolagsverketEnvironment } : {}),
      ...(certPem ? { clientCertPem: certPem } : {}),
      ...(keyPem ? { clientKeyPem: keyPem } : {}),
    }),
  )
}

async function companyOrgnr(ctx: ExtensionContext): Promise<string> {
  const { data } = await ctx.supabase
    .from('company_settings')
    .select('org_number')
    .eq('company_id', ctx.companyId)
    .maybeSingle()
  const orgNumber = (data as { org_number?: string } | null)?.org_number
  if (!orgNumber) throw new Error('Organisationsnummer saknas i företagsinställningarna.')
  return normalizeOrgnr(orgNumber)
}

function apiErrorResponse(err: unknown): NextResponse {
  if (err instanceof BolagsverketApiError) {
    return NextResponse.json(
      { error: { code: 'BOLAGSVERKET_API', message: err.message } },
      { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
    )
  }
  const message = err instanceof Error ? err.message : 'Okänt fel'
  return NextResponse.json(
    { error: { code: 'BOLAGSVERKET_ERROR', message } },
    { status: 500 },
  )
}

const SubmitSchema = z.object({
  fiscal_period_id: z.string().uuid(),
  avsandare_pnr: z.string().regex(/^\d{10,12}$/, 'Personnummer anges med 10–12 siffror'),
  undertecknare: z.object({
    pnr: z.string().regex(/^\d{10,12}$/, 'Personnummer anges med 10–12 siffror'),
    fornamn: z.string().min(1).max(100),
    efternamn: z.string().min(1).max(100),
    roll: z.string().min(1).max(100),
    epost: z.string().email(),
  }),
  kvittens_epost: z.array(z.string().email()).max(5).optional(),
  utdelning: z.number().min(0).optional(),
  accepted_avtalstext_andrad: z.string().optional(),
  ignore_warnings: z.boolean().optional(),
})

const PollSchema = z.object({
  fromtidpunkt: z.string().optional(),
})

export const bolagsverketExtension: Extension = {
  id: 'bolagsverket',
  name: 'Bolagsverket — digital årsredovisning',
  version: '1.0.0',
  settingsPanel: { label: 'Bolagsverket', path: '/settings/extensions' },
  apiRoutes: [
    {
      method: 'GET',
      path: '/status',
      handler: async (_request, ctx) => {
        if (!ctx) return NextResponse.json({ error: { code: 'NO_CONTEXT', message: 'Saknar kontext' } }, { status: 500 })
        const client = await clientFor(ctx)
        const config = configFromEnv()
        return NextResponse.json({
          data: {
            environment: client.environment,
            has_certificate: Boolean(config.clientCertPem && config.clientKeyPem),
          },
        })
      },
    },
    {
      method: 'GET',
      path: '/grunduppgifter',
      handler: async (_request, ctx) => {
        if (!ctx) return NextResponse.json({ error: { code: 'NO_CONTEXT', message: 'Saknar kontext' } }, { status: 500 })
        try {
          const client = await clientFor(ctx)
          const orgnr = await companyOrgnr(ctx)
          const data = await client.getGrunduppgifter(orgnr)
          return NextResponse.json({ data })
        } catch (err) {
          return apiErrorResponse(err)
        }
      },
    },
    {
      method: 'GET',
      path: '/arendestatus',
      handler: async (_request, ctx) => {
        if (!ctx) return NextResponse.json({ error: { code: 'NO_CONTEXT', message: 'Saknar kontext' } }, { status: 500 })
        try {
          const client = await clientFor(ctx)
          const orgnr = await companyOrgnr(ctx)
          const data = await client.getArendestatus(orgnr)
          return NextResponse.json({ data })
        } catch (err) {
          return apiErrorResponse(err)
        }
      },
    },
    {
      method: 'GET',
      path: '/submissions',
      handler: async (request, ctx) => {
        if (!ctx) return NextResponse.json({ error: { code: 'NO_CONTEXT', message: 'Saknar kontext' } }, { status: 500 })
        const url = new URL(request.url)
        const fiscalPeriodId = url.searchParams.get('fiscal_period_id')
        let query = ctx.supabase
          .from('arsredovisning_submissions')
          .select(
            'id, fiscal_period_id, handling_typ, taxonomy_version, entry_point, environment, status, undertecknare_namn, undertecknare_epost, idnummer, sha256_checksumma, kontrollsumma, bolagsverket_url, kontrollera_utfall, error_message, uploaded_at, registered_at, created_at, updated_at',
          )
          .eq('company_id', ctx.companyId)
          .order('created_at', { ascending: false })
          .limit(50)
        if (fiscalPeriodId) query = query.eq('fiscal_period_id', fiscalPeriodId)
        const { data, error } = await query
        if (error) {
          return NextResponse.json(
            { error: { code: 'DB_ERROR', message: error.message } },
            { status: 500 },
          )
        }
        return NextResponse.json({ data })
      },
    },
    {
      method: 'POST',
      path: '/submissions',
      handler: async (request, ctx) => {
        if (!ctx) return NextResponse.json({ error: { code: 'NO_CONTEXT', message: 'Saknar kontext' } }, { status: 500 })
        let parsed: z.infer<typeof SubmitSchema>
        try {
          parsed = SubmitSchema.parse(await request.json())
        } catch (err) {
          const message =
            err instanceof z.ZodError ? err.issues.map((issue) => issue.message).join('; ') : 'Ogiltig begäran'
          return NextResponse.json(
            { error: { code: 'VALIDATION', message } },
            { status: 400 },
          )
        }
        try {
          const client = await clientFor(ctx)
          const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
          const result = await submitArsredovisning(
            { supabase: ctx.supabase, client, appUrl },
            {
              companyId: ctx.companyId,
              userId: ctx.userId,
              fiscalPeriodId: parsed.fiscal_period_id,
              avsandarePnr: parsed.avsandare_pnr,
              undertecknare: parsed.undertecknare,
              kvittensEpost: parsed.kvittens_epost,
              proposedDividend: parsed.utdelning,
              acceptedAvtalstextAndrad: parsed.accepted_avtalstext_andrad,
              ignoreWarnings: parsed.ignore_warnings,
            },
          )
          return NextResponse.json({ data: result })
        } catch (err) {
          ctx.log.error('bolagsverket submission failed', err)
          return apiErrorResponse(err)
        }
      },
    },
    {
      // Webhook receiver for händelsemeddelanden (GUIDE §5.4.5 + Appendix D).
      // skipAuth: Bolagsverket authenticates with the `auth` header we set at
      // subscription time; validated against bolagsverket_subscriptions.
      method: 'POST',
      path: '/webhook',
      skipAuth: true,
      handler: async (request) => {
        let message: HandelseMeddelande
        try {
          message = (await request.json()) as HandelseMeddelande
        } catch {
          return NextResponse.json({ ok: false, reason: 'invalid json' }, { status: 400 })
        }
        const serviceClient = createServiceClientNoCookies()
        const result = await handleWebhook(
          serviceClient,
          message,
          request.headers.get('auth'),
        )
        return NextResponse.json(result.body, { status: result.status })
      },
    },
    {
      // Polling fallback: fetch händelser kept by Bolagsverket (~1 year) in
      // case webhook deliveries were missed (GUIDE §5.4.4).
      method: 'POST',
      path: '/poll-events',
      handler: async (request, ctx) => {
        if (!ctx) return NextResponse.json({ error: { code: 'NO_CONTEXT', message: 'Saknar kontext' } }, { status: 500 })
        let parsed: z.infer<typeof PollSchema>
        try {
          parsed = PollSchema.parse(await request.json().catch(() => ({})))
        } catch {
          parsed = {}
        }
        try {
          const client = await clientFor(ctx)
          const orgnr = await companyOrgnr(ctx)
          const { data: sub } = await ctx.supabase
            .from('bolagsverket_subscriptions')
            .select('url')
            .eq('company_id', ctx.companyId)
            .eq('orgnr', orgnr)
            .eq('environment', client.environment)
            .maybeSingle()
          if (!sub) {
            return NextResponse.json(
              { error: { code: 'NO_SUBSCRIPTION', message: 'Ingen händelseprenumeration finns för företaget ännu.' } },
              { status: 404 },
            )
          }
          const svar = await client.hamtaHandelser({
            url: (sub as { url: string }).url,
            orgnr: [orgnr],
            ...(parsed.fromtidpunkt ? { fromtidpunkt: parsed.fromtidpunkt } : {}),
          })
          for (const message of svar.meddelanden) {
            await applyHandelse(ctx.supabase, message, [ctx.companyId])
          }
          return NextResponse.json({ data: { applied: svar.meddelanden.length } })
        } catch (err) {
          return apiErrorResponse(err)
        }
      },
    },
  ],
}

export default bolagsverketExtension
