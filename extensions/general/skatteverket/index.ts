import crypto from 'crypto'
import type { Extension, ExtensionContext } from '@/lib/extensions/types'
import { NextResponse } from 'next/server'
import { TimeoutError } from '@/lib/http/fetch-with-timeout'
import { buildAuthorizeUrl, exchangeCodeForTokens } from './lib/oauth'
import { storeTokens, getTokens, deleteTokens } from './lib/token-store'
import { skvRequest, SkatteverketAuthError } from './lib/api-client'
import { rutorToMomsuppgift, formatRedovisare, formatRedovisningsperiod } from './lib/mappers'
import { calculateVatDeclaration } from '@/lib/reports/vat-declaration'
import {
  agiPostUnderlag,
  agiGetKontrollresultat,
  agiSparaUnderlag,
  agiAvbrytUnderlag,
  agiTaBortSparadInlamning,
  agiSkapaGranskningsunderlag,
  agiGetKvittenser,
  agiLasPeriod,
  agiLasUppPeriod,
} from './lib/agi-client'
import { syncSkattekonto, SKATTEKONTO_BALANCE_SNAPSHOT_KEY, SKATTEKONTO_LAST_SYNCED_AT_KEY } from './lib/skattekonto-sync'
import { bokforSkattekontoTransaction, SkattekontoBookingError } from './lib/skattekonto-booking'
import type { SkattekontoBalanceSnapshot } from './types'
import type { VatPeriodType } from '@/types'

/**
 * Skatteverket integration extension.
 *
 * Enables filing momsdeklaration (VAT declaration) directly to Skatteverket
 * via their Momsdeklaration API 1.0. Users authenticate with BankID through
 * the `per` (e-legitimation) OAuth2 flow.
 *
 * Required environment variables:
 * - SKATTEVERKET_OAUTH2_CLIENT_ID
 * - SKATTEVERKET_OAUTH2_CLIENT_SECRET
 * - SKATTEVERKET_APIGW_CLIENT_ID
 * - SKATTEVERKET_APIGW_CLIENT_SECRET
 * - SKATTEVERKET_TOKEN_ENCRYPTION_KEY
 *
 * Optional:
 * - SKATTEVERKET_OAUTH_BASE_URL (defaults to test environment)
 * - SKATTEVERKET_API_BASE_URL (defaults to test environment)
 */
export const skatteverketExtension: Extension = {
  id: 'skatteverket',
  name: 'Skatteverket Integration',
  version: '1.0.0',

  settingsPanel: {
    label: 'Skatteverket',
    path: '/settings/account',
  },

  apiRoutes: [
    // ── OAuth: Start authorization ──────────────────────────────────
    // Builds the Skatteverket OAuth2 authorize URL and redirects the user
    // to BankID login. Stores state token in extension settings for CSRF validation.
    {
      method: 'GET',
      path: '/authorize',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        const state = crypto.randomUUID()
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const redirectUri = `${appUrl}/api/extensions/ext/skatteverket/callback`

        // Optional: where to send the user after the BankID round-trip.
        // Allowlisted to internal in-app paths to avoid open-redirect abuse.
        const url = new URL(request.url)
        const requestedReturn = url.searchParams.get('return_to')
        const returnTo =
          requestedReturn && requestedReturn.startsWith('/') && !requestedReturn.startsWith('//')
            ? requestedReturn
            : null

        // Store state for CSRF validation in callback
        await ctx.settings.set('oauth_state', state)
        await ctx.settings.set('oauth_redirect_uri', redirectUri)
        if (returnTo) await ctx.settings.set('oauth_return_to', returnTo)
        else await ctx.settings.set('oauth_return_to', null)

        const authorizeUrl = buildAuthorizeUrl(redirectUri, state)

        return NextResponse.redirect(authorizeUrl)
      },
    },

    // ── OAuth: Callback ─────────────────────────────────────────────
    // Receives the auth code from Skatteverket after BankID login.
    // Exchanges code for tokens immediately (5-minute code expiry).
    // skipAuth: true — browser redirect from Skatteverket. We handle
    // user identification via the stored state token + Supabase session.
    {
      method: 'GET',
      path: '/callback',
      skipAuth: true,
      handler: async (request: Request) => {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          const desc = url.searchParams.get('error_description') || 'Okänt fel'
          return NextResponse.redirect(
            `${appUrl}/reports?tab=vat-declaration&skv_error=${encodeURIComponent(desc)}`
          )
        }

        if (!code || !state) {
          return NextResponse.redirect(
            `${appUrl}/reports?tab=vat-declaration&skv_error=${encodeURIComponent('Saknar auktoriseringskod')}`
          )
        }

        // Exchange code FIRST — 5-minute expiry, do this before anything else
        const { createClient } = await import('@/lib/supabase/server')
        const { requireCompanyId } = await import('@/lib/company/context')
        const supabase = await createClient()

        // Verify user session (browser should still have cookies)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          return NextResponse.redirect(
            `${appUrl}/login?redirect=${encodeURIComponent('/reports?tab=vat-declaration')}`
          )
        }

        // Resolve the active company — state/redirect_uri were stored keyed on company_id
        // by ctx.settings.set() in the /authorize handler.
        let companyId: string
        try {
          companyId = await requireCompanyId(supabase, user.id)
        } catch {
          return NextResponse.redirect(
            `${appUrl}/reports?tab=vat-declaration&skv_error=${encodeURIComponent('Inget företag valt')}`
          )
        }

        // Validate CSRF state
        const { data: settingsData } = await supabase
          .from('extension_data')
          .select('value')
          .eq('company_id', companyId)
          .eq('extension_id', 'skatteverket')
          .eq('key', 'oauth_state')
          .single()

        if (!settingsData || settingsData.value !== state) {
          return NextResponse.redirect(
            `${appUrl}/reports?tab=vat-declaration&skv_error=${encodeURIComponent('Ogiltig state-parameter (CSRF)')}`
          )
        }

        // Get the stored redirect URI
        const { data: redirectData } = await supabase
          .from('extension_data')
          .select('value')
          .eq('company_id', companyId)
          .eq('extension_id', 'skatteverket')
          .eq('key', 'oauth_redirect_uri')
          .single()

        const redirectUri = redirectData?.value ||
          `${appUrl}/api/extensions/ext/skatteverket/callback`

        // Optional in-app destination set by /authorize?return_to=...
        const { data: returnToData } = await supabase
          .from('extension_data')
          .select('value')
          .eq('company_id', companyId)
          .eq('extension_id', 'skatteverket')
          .eq('key', 'oauth_return_to')
          .maybeSingle()

        const returnTo = (returnToData?.value as string | null) || null
        const successPath = returnTo
          ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}skv_connected=true`
          : `${appUrl}/reports?tab=vat-declaration&skv_connected=true`
        const errorPath = (msg: string) =>
          returnTo
            ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}skv_error=${encodeURIComponent(msg)}`
            : `${appUrl}/reports?tab=vat-declaration&skv_error=${encodeURIComponent(msg)}`

        try {
          const tokens = await exchangeCodeForTokens(code, redirectUri)
          await storeTokens(supabase, user.id, tokens, companyId)

          // Clean up CSRF state + the one-shot return_to.
          await supabase
            .from('extension_data')
            .delete()
            .eq('company_id', companyId)
            .eq('extension_id', 'skatteverket')
            .in('key', ['oauth_state', 'oauth_return_to'])

          const success = returnTo
            ? `${appUrl}${successPath}`
            : successPath
          return NextResponse.redirect(success)
        } catch (err) {
          console.error('[skatteverket] Token exchange failed:', err)
          // BankID auth codes expire after 5 minutes. Surface timeouts distinctly
          // so the user retries quickly instead of exhausting the code window.
          const message = err instanceof TimeoutError
            ? 'Tidsgränsen mot Skatteverket överskreds — försök igen med BankID'
            : err instanceof Error
              ? err.message
              : 'Token exchange misslyckades'
          const target = returnTo ? `${appUrl}${errorPath(message)}` : errorPath(message)
          return NextResponse.redirect(target)
        }
      },
    },

    // ── Connection status ───────────────────────────────────────────
    {
      method: 'GET',
      path: '/status',
      handler: async (_request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        const tokens = await getTokens(ctx.supabase, ctx.userId)
        if (!tokens) {
          return NextResponse.json({ connected: false })
        }

        const expired = tokens.expires_at < Date.now()
        const canRefresh = tokens.refresh_token !== null && tokens.refresh_count < 10

        return NextResponse.json({
          connected: true,
          expired,
          canRefresh,
          scope: tokens.scope,
          expiresAt: new Date(tokens.expires_at).toISOString(),
        })
      },
    },

    // ── Disconnect ──────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/disconnect',
      handler: async (_request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        await deleteTokens(ctx.supabase, ctx.userId)
        return NextResponse.json({ success: true })
      },
    },

    // ── Validate declaration (dry run) ──────────────────────────────
    // Sends momsuppgift to Skatteverket's /kontrollera endpoint.
    // Returns ERROR/WARNING/OK without saving anything.
    {
      method: 'POST',
      path: '/declaration/validate',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { redovisare, redovisningsperiod, momsuppgift } =
            await parseDeclarationRequest(request, ctx)

          console.log('[skatteverket] Validating:', {
            redovisare,
            redovisningsperiod,
            momsuppgift: JSON.stringify(momsuppgift),
          })

          const response = await skvRequest(
            ctx.supabase,
            ctx.userId,
            'POST',
            `/kontrollera/${redovisare}/${redovisningsperiod}`,
            momsuppgift
          )

          if (!response.ok) {
            const text = await response.text()
            console.error('[skatteverket] Validate error:', response.status, text)
            return NextResponse.json(
              { error: `Skatteverket svarade med ${response.status}: ${text}` },
              { status: response.status }
            )
          }

          const data = await response.json()
          return NextResponse.json({ data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── Save draft ──────────────────────────────────────────────────
    // Saves momsuppgift to Skatteverket's "Eget utrymme".
    // Returns validation results. Optionally lock for signing.
    {
      method: 'POST',
      path: '/declaration/draft',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { redovisare, redovisningsperiod, momsuppgift } =
            await parseDeclarationRequest(request, ctx)

          console.log('[skatteverket] Sending draft:', {
            redovisare,
            redovisningsperiod,
            momsuppgift: JSON.stringify(momsuppgift),
          })

          const response = await skvRequest(
            ctx.supabase,
            ctx.userId,
            'POST',
            `/utkast/${redovisare}/${redovisningsperiod}`,
            momsuppgift
          )

          if (!response.ok) {
            const text = await response.text()
            console.error('[skatteverket] Draft error:', response.status, text)
            return NextResponse.json(
              { error: `Skatteverket svarade med ${response.status}: ${text}` },
              { status: response.status }
            )
          }

          const data = await response.json()

          // Track submission status
          await ctx.settings.set(
            `submission_${redovisningsperiod}`,
            JSON.stringify({
              status: 'draft_saved',
              redovisare,
              redovisningsperiod,
              kontrollresultat: data.kontrollresultat,
              updatedAt: new Date().toISOString(),
            })
          )

          return NextResponse.json({ data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── Fetch draft ─────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/declaration/draft',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { redovisare, redovisningsperiod } = parseQueryParams(request, ctx)

          const response = await skvRequest(
            ctx.supabase,
            ctx.userId,
            'GET',
            `/utkast/${redovisare}/${redovisningsperiod}`
          )

          if (response.status === 404) {
            return NextResponse.json({ data: null })
          }

          if (!response.ok) {
            const text = await response.text()
            return NextResponse.json(
              { error: `Skatteverket svarade med ${response.status}: ${text}` },
              { status: response.status }
            )
          }

          const data = await response.json()
          return NextResponse.json({ data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── Delete draft ────────────────────────────────────────────────
    {
      method: 'DELETE',
      path: '/declaration/draft',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { redovisare, redovisningsperiod } = parseQueryParams(request, ctx)

          const response = await skvRequest(
            ctx.supabase,
            ctx.userId,
            'DELETE',
            `/utkast/${redovisare}/${redovisningsperiod}`
          )

          if (response.status !== 204 && !response.ok) {
            const text = await response.text()
            return NextResponse.json(
              { error: `Skatteverket svarade med ${response.status}: ${text}` },
              { status: response.status }
            )
          }

          await ctx.settings.set(`submission_${redovisningsperiod}`, null)
          return NextResponse.json({ success: true })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── Lock draft for signing ──────────────────────────────────────
    // Returns a signeringslänk (deep link) that the user opens
    // in a new tab to sign with BankID on Skatteverket's site.
    {
      method: 'PUT',
      path: '/declaration/lock',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { redovisare, redovisningsperiod } = parseQueryParams(request, ctx)

          const response = await skvRequest(
            ctx.supabase,
            ctx.userId,
            'PUT',
            `/las/${redovisare}/${redovisningsperiod}`
          )

          if (!response.ok) {
            const text = await response.text()
            return NextResponse.json(
              { error: `Skatteverket svarade med ${response.status}: ${text}` },
              { status: response.status }
            )
          }

          const data = await response.json()

          await ctx.settings.set(
            `submission_${redovisningsperiod}`,
            JSON.stringify({
              status: 'draft_locked',
              redovisare,
              redovisningsperiod,
              signeringsLank: data.signeringsLank,
              updatedAt: new Date().toISOString(),
            })
          )

          return NextResponse.json({ data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── Unlock draft ────────────────────────────────────────────────
    {
      method: 'DELETE',
      path: '/declaration/lock',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { redovisare, redovisningsperiod } = parseQueryParams(request, ctx)

          const response = await skvRequest(
            ctx.supabase,
            ctx.userId,
            'DELETE',
            `/las/${redovisare}/${redovisningsperiod}`
          )

          if (response.status !== 204 && !response.ok) {
            const text = await response.text()
            return NextResponse.json(
              { error: `Skatteverket svarade med ${response.status}: ${text}` },
              { status: response.status }
            )
          }

          await ctx.settings.set(
            `submission_${redovisningsperiod}`,
            JSON.stringify({
              status: 'draft_saved',
              redovisare,
              redovisningsperiod,
              updatedAt: new Date().toISOString(),
            })
          )

          return NextResponse.json({ success: true })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── Fetch submitted declaration ─────────────────────────────────
    {
      method: 'GET',
      path: '/declaration/submitted',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { redovisare, redovisningsperiod } = parseQueryParams(request, ctx)

          const response = await skvRequest(
            ctx.supabase,
            ctx.userId,
            'GET',
            `/inlamnat/${redovisare}/${redovisningsperiod}`
          )

          if (response.status === 404) {
            return NextResponse.json({ data: null })
          }

          if (!response.ok) {
            const text = await response.text()
            return NextResponse.json(
              { error: `Skatteverket svarade med ${response.status}: ${text}` },
              { status: response.status }
            )
          }

          const data = await response.json()
          return NextResponse.json({ data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── Fetch decided declaration ───────────────────────────────────
    {
      method: 'GET',
      path: '/declaration/decided',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { redovisare, redovisningsperiod } = parseQueryParams(request, ctx)

          const response = await skvRequest(
            ctx.supabase,
            ctx.userId,
            'GET',
            `/beslutat/${redovisare}/${redovisningsperiod}`
          )

          if (response.status === 404) {
            return NextResponse.json({ data: null })
          }

          if (!response.ok) {
            const text = await response.text()
            return NextResponse.json(
              { error: `Skatteverket svarade med ${response.status}: ${text}` },
              { status: response.status }
            )
          }

          const data = await response.json()
          return NextResponse.json({ data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },
    // ══════════════════════════════════════════════════════════════
    // AGI (Arbetsgivardeklaration) routes
    //
    // AGI submission is XML, not JSON. We feed agi_declarations.xml_content
    // (built by lib/salary/agi/xml-generator.ts) to POST /underlag, then poll
    // kontrollresultat, save into Eget utrymme, and return a Mina Sidor
    // signing link via skapaGranskningsunderlag. After the user signs we
    // observe the kvittenser endpoint to record kvittensnummer/signeradTid.
    //
    // The route surface mirrors the conceptual flow rather than the literal
    // SKV endpoints so the frontend stays simple. Two SKV APIs are involved:
    // inlamning (XML ingest + JSON status) and hanteraredovisningsperiod
    // (kvittenser + las/lasUpp). The agi-client encapsulates both.
    // ══════════════════════════════════════════════════════════════

    // ── AGI: Submit (POST /underlag with stored XML) ────────────────
    // Body: { salaryRunId }. Reads agi_declarations.xml_content for the run,
    // posts it to Skatteverket, returns { inlamningId } so the caller can
    // poll kontrollresultat. Also persists inlamningId locally for recovery.
    {
      method: 'POST',
      path: '/agi/submit',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        try {
          const { arbetsgivare, period, salaryRunId, xml } = await loadAGIXml(request, ctx)

          console.log('[skatteverket] AGI submitting underlag:', { arbetsgivare, period })

          const result = await agiPostUnderlag(ctx.supabase, ctx.userId, xml)
          if (!result.ok) {
            console.error('[skatteverket] AGI underlag error:', result.status, result.error)
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }

          await ctx.settings.set(
            `agi_submission_${period}`,
            JSON.stringify({
              status: 'underlag_submitted',
              arbetsgivare,
              period,
              salaryRunId,
              inlamningId: result.data.inlamningId,
              updatedAt: new Date().toISOString(),
            }),
          )

          await ctx.supabase
            .from('agi_declarations')
            .update({ status: 'exported' })
            .eq('salary_run_id', salaryRunId)
            .eq('company_id', ctx.companyId)

          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Poll kontrollresultat ──────────────────────────────────
    // Query: ?inlamningId=...
    // Returns { status: PROCESSING | DONE_SUCCESS | DONE_FAILED | DONE_REJECTED, ... }
    {
      method: 'GET',
      path: '/agi/kontrollresultat',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        try {
          const url = new URL(request.url)
          const inlamningId = Number(url.searchParams.get('inlamningId'))
          if (!Number.isFinite(inlamningId) || inlamningId <= 0) {
            return NextResponse.json({ error: 'Saknar parameter: inlamningId' }, { status: 400 })
          }

          const result = await agiGetKontrollresultat(ctx.supabase, ctx.userId, inlamningId)
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }
          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Save underlag into Eget utrymme ────────────────────────
    // Body: { inlamningId, salaryRunId? }. Only meaningful between
    // POST /underlag and skapaGranskningsunderlag.
    {
      method: 'POST',
      path: '/agi/spara',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        try {
          const body = (await request.json()) as { inlamningId?: number; salaryRunId?: string }
          const inlamningId = Number(body.inlamningId)
          if (!Number.isFinite(inlamningId) || inlamningId <= 0) {
            return NextResponse.json({ error: 'Saknar inlamningId' }, { status: 400 })
          }

          const result = await agiSparaUnderlag(ctx.supabase, ctx.userId, inlamningId)
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }
          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Avbryt underlag (before spara) ─────────────────────────
    // Query: ?inlamningId=...
    {
      method: 'DELETE',
      path: '/agi/underlag',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        try {
          const url = new URL(request.url)
          const inlamningId = Number(url.searchParams.get('inlamningId'))
          if (!Number.isFinite(inlamningId) || inlamningId <= 0) {
            return NextResponse.json({ error: 'Saknar parameter: inlamningId' }, { status: 400 })
          }
          const result = await agiAvbrytUnderlag(ctx.supabase, ctx.userId, inlamningId)
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }
          return NextResponse.json({ success: true })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Ta bort sparad inlämning (after spara) ─────────────────
    // Query: ?arbetsgivare=...&period=YYYYMM&inlamningId=...
    {
      method: 'DELETE',
      path: '/agi/sparad',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        try {
          const url = new URL(request.url)
          const arbetsgivare = url.searchParams.get('arbetsgivare')
          const period = url.searchParams.get('period')
          const inlamningId = Number(url.searchParams.get('inlamningId'))
          if (!arbetsgivare || !period || !Number.isFinite(inlamningId) || inlamningId <= 0) {
            return NextResponse.json(
              { error: 'Saknar parametrar: arbetsgivare, period, inlamningId' },
              { status: 400 },
            )
          }
          const result = await agiTaBortSparadInlamning(
            ctx.supabase, ctx.userId, arbetsgivare, period, inlamningId,
          )
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }
          await ctx.settings.set(`agi_submission_${period}`, null)
          return NextResponse.json({ success: true })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Skapa granskningsunderlag (BankID signing link) ────────
    // Query: ?arbetsgivare=...&period=YYYYMM&lasPeriod=true|false
    // Returns { link, tillstand, meddelande }. The user opens `link` in a
    // new tab and signs with BankID on Skatteverket's site.
    {
      method: 'POST',
      path: '/agi/granskningsunderlag',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        try {
          const url = new URL(request.url)
          const arbetsgivare = url.searchParams.get('arbetsgivare')
          const period = url.searchParams.get('period')
          const lasPeriod = url.searchParams.get('lasPeriod') !== 'false'  // default true

          if (!arbetsgivare || !period) {
            return NextResponse.json(
              { error: 'Saknar parametrar: arbetsgivare, period' },
              { status: 400 },
            )
          }

          const result = await agiSkapaGranskningsunderlag(
            ctx.supabase, ctx.userId, arbetsgivare, period, { lasPeriod },
          )
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }

          // Persist the link so the user can return to it after a refresh.
          // INCORRECT_DATA (status 409) also returns a link to the felrapport;
          // surface it as `signing_failed_link` so the UI can route there.
          const isError = result.status === 409 || result.data.tillstand === 'INCORRECT_DATA'
          await ctx.settings.set(
            `agi_submission_${period}`,
            JSON.stringify({
              status: isError ? 'underlag_rejected' : 'awaiting_signing',
              arbetsgivare,
              period,
              signeringslank: result.data.link,
              tillstand: result.data.tillstand,
              meddelande: result.data.meddelande,
              updatedAt: new Date().toISOString(),
            }),
          )

          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Hämta kvittenser (after user signs) ────────────────────
    // Query: ?arbetsgivare=...&period=YYYYMM
    // Returns the kvittenser array. While the user has not yet signed the
    // array is empty; after signing it carries uuidKvittens/signeradAv/-Tid.
    {
      method: 'GET',
      path: '/agi/kvittenser',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        try {
          const url = new URL(request.url)
          const arbetsgivare = url.searchParams.get('arbetsgivare')
          const period = url.searchParams.get('period')
          if (!arbetsgivare || !period) {
            return NextResponse.json(
              { error: 'Saknar parametrar: arbetsgivare, period' },
              { status: 400 },
            )
          }

          const result = await agiGetKvittenser(ctx.supabase, ctx.userId, arbetsgivare, period)
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }

          // Newest kvittens for the period drives the local state.
          const kvittens = result.data.kvittenser?.[0]
          if (kvittens?.uuidKvittens) {
            const periodYear = parseInt(period.slice(0, 4))
            const periodMonth = parseInt(period.slice(4, 6))
            await ctx.settings.set(
              `agi_submission_${period}`,
              JSON.stringify({
                status: 'signed',
                arbetsgivare,
                period,
                kvittensnummer: kvittens.uuidKvittens,
                signeradAv: kvittens.signeradAv,
                signeradTid: kvittens.signeradTid,
                updatedAt: new Date().toISOString(),
              }),
            )

            // Pin the receipt to the most recent declaration for this period
            // (id desc) so a correction chain doesn't get its kvittens written
            // onto a superseded row.
            const { data: latest } = await ctx.supabase
              .from('agi_declarations')
              .select('id')
              .eq('company_id', ctx.companyId)
              .eq('period_year', periodYear)
              .eq('period_month', periodMonth)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (latest?.id) {
              await ctx.supabase
                .from('agi_declarations')
                .update({
                  status: 'submitted',
                  kvittensnummer: kvittens.uuidKvittens,
                  submitted_at: kvittens.signeradTid || new Date().toISOString(),
                  submitted_by: ctx.userId,
                })
                .eq('id', latest.id)
            }
          }

          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Lås period ─────────────────────────────────────────────
    // Hantera-API; typically not needed (skapaGranskningsunderlag already
    // accepts lasPeriod=true). Exposed for recovery / manual control.
    {
      method: 'POST',
      path: '/agi/las',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        try {
          const url = new URL(request.url)
          const arbetsgivare = url.searchParams.get('arbetsgivare')
          const period = url.searchParams.get('period')
          if (!arbetsgivare || !period) {
            return NextResponse.json(
              { error: 'Saknar parametrar: arbetsgivare, period' },
              { status: 400 },
            )
          }
          const result = await agiLasPeriod(ctx.supabase, ctx.userId, arbetsgivare, period)
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }
          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Lås upp period ─────────────────────────────────────────
    {
      method: 'POST',
      path: '/agi/lasUpp',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        try {
          const url = new URL(request.url)
          const arbetsgivare = url.searchParams.get('arbetsgivare')
          const period = url.searchParams.get('period')
          if (!arbetsgivare || !period) {
            return NextResponse.json(
              { error: 'Saknar parametrar: arbetsgivare, period' },
              { status: 400 },
            )
          }
          const result = await agiLasUppPeriod(ctx.supabase, ctx.userId, arbetsgivare, period)
          if (!result.ok) {
            return NextResponse.json(
              { error: result.error, code: result.body?.kod },
              { status: result.status },
            )
          }
          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Local submission tracking (UI helper) ──────────────────
    // Returns the locally-cached submission state (inlamningId, signing link,
    // kvittensnummer if seen). Pure read; never calls Skatteverket.
    {
      method: 'GET',
      path: '/agi/status',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        const url = new URL(request.url)
        const period = url.searchParams.get('period')
        if (!period) return NextResponse.json({ error: 'Saknar parameter: period' }, { status: 400 })

        const statusJson = await ctx.settings.get<string>(`agi_submission_${period}`)
        if (!statusJson) return NextResponse.json({ data: null })
        try {
          return NextResponse.json({ data: JSON.parse(statusJson) })
        } catch {
          return NextResponse.json({ data: null })
        }
      },
    },

    // ══════════════════════════════════════════════════════════════
    // Skattekonto routes (read-only balance + transactions)
    // ══════════════════════════════════════════════════════════════

    // ── Saldo (cached snapshot) ────────────────────────────────────
    // Returns the most recent saldoResponse cached in extension_data.
    // The dashboard uses this for repeated renders without hitting SKV.
    // Force a refresh by calling POST /skattekonto/sync first.
    {
      method: 'GET',
      path: '/skattekonto/saldo',
      handler: async (_request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        const snapshot = await ctx.settings.get<SkattekontoBalanceSnapshot>(SKATTEKONTO_BALANCE_SNAPSHOT_KEY)
        const lastSyncedAt = await ctx.settings.get<string>(SKATTEKONTO_LAST_SYNCED_AT_KEY)
        return NextResponse.json({
          data: snapshot?.saldo ?? null,
          fetchedAt: snapshot ? new Date(snapshot.fetchedAt).toISOString() : null,
          lastSyncedAt: lastSyncedAt ?? null,
        })
      },
    },

    // ── Transaktioner (from local table) ───────────────────────────
    // Returns booked + upcoming transactions for the active company.
    // Optional `from` query filters tidigare on transaktionsdatum >= from.
    {
      method: 'GET',
      path: '/skattekonto/transaktioner',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        const url = new URL(request.url)
        const from = url.searchParams.get('from')

        let query = ctx.supabase
          .from('skattekonto_transactions')
          .select('*')
          .eq('company_id', ctx.companyId)
          .order('transaktionsdatum', { ascending: false })

        if (from) query = query.gte('transaktionsdatum', from)

        const { data, error } = await query
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({
          data: {
            booked: (data ?? []).filter(r => r.status === 'booked'),
            upcoming: (data ?? []).filter(r => r.status === 'upcoming'),
          },
        })
      },
    },

    // ── Manual sync ────────────────────────────────────────────────
    // Pulls fresh saldo + transactions from Skatteverket and upserts.
    {
      method: 'POST',
      path: '/skattekonto/sync',
      handler: async (_request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }
        try {
          const result = await syncSkattekonto(ctx)
          return NextResponse.json({ data: result })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── Bokför one row → draft journal entry ──────────────────────
    // Creates a DRAFT verifikat in /bookkeeping for the user to review
    // and commit. The skattekonto_transactions row is linked via
    // journal_entry_id so the UI can show "Bokförd" status.
    {
      method: 'POST',
      path: '/skattekonto/transaktioner/:id/bokfor',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        // Extract :id from the catch-all dispatcher's path-param convention
        // (`_id` query string, set in app/api/extensions/ext/[...path]/route.ts).
        const url = new URL(request.url)
        const id = url.searchParams.get('_id')
        if (!id) {
          return NextResponse.json({ error: 'Saknar transaktions-id' }, { status: 400 })
        }

        try {
          const entry = await bokforSkattekontoTransaction(
            ctx.supabase,
            ctx.companyId,
            ctx.userId,
            id,
          )
          return NextResponse.json({ data: { entry } })
        } catch (err) {
          if (err instanceof SkattekontoBookingError) {
            const status =
              err.code === 'TRANSACTION_NOT_FOUND' ? 404
              : err.code === 'ALREADY_BOOKED' ? 409
              : err.code === 'PERIOD_LOCKED' ? 423
              : err.code === 'NO_COUNTER_ACCOUNT' ? 422
              : 400
            return NextResponse.json(
              { error: err.message, code: err.code },
              { status },
            )
          }
          return handleSkvError(err)
        }
      },
    },
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Parse and validate declaration request body.
 * Computes momsuppgift from gnubok's VAT calculation if not provided directly.
 */
async function parseDeclarationRequest(
  request: Request,
  ctx: ExtensionContext
): Promise<{
  redovisare: string
  redovisningsperiod: string
  momsuppgift: ReturnType<typeof rutorToMomsuppgift>
}> {
  const body = await request.json()
  const { periodType, year, period } = body as {
    periodType: VatPeriodType
    year: number
    period: number
  }

  if (!periodType || !year || !period) {
    throw new Error('Saknar obligatoriska fält: periodType, year, period')
  }

  // Get company settings for redovisare formatting
  const { data: settings } = await ctx.supabase
    .from('company_settings')
    .select('org_number, entity_type')
    .eq('company_id', ctx.companyId)
    .single()

  if (!settings?.org_number) {
    throw new Error('Organisationsnummer saknas i företagsinställningar')
  }

  const redovisare = formatRedovisare(settings.org_number, settings.entity_type)
  const redovisningsperiod = formatRedovisningsperiod(periodType, year, period)

  // Calculate VAT declaration from the general ledger
  const declaration = await calculateVatDeclaration(
    ctx.supabase,
    ctx.companyId,
    periodType,
    year,
    period
  )

  const momsuppgift = rutorToMomsuppgift(declaration.rutor)

  return { redovisare, redovisningsperiod, momsuppgift }
}

/**
 * Parse redovisare and redovisningsperiod from query params.
 * Used by GET/PUT/DELETE endpoints that don't need a full body.
 */
function parseQueryParams(
  request: Request,
  ctx: ExtensionContext
): { redovisare: string; redovisningsperiod: string } {
  const url = new URL(request.url)
  const redovisare = url.searchParams.get('redovisare')
  const redovisningsperiod = url.searchParams.get('redovisningsperiod')

  if (!redovisare || !redovisningsperiod) {
    throw new Error('Saknar obligatoriska parametrar: redovisare, redovisningsperiod')
  }

  // Suppress unused variable warning — ctx is required by the type signature
  void ctx

  return { redovisare, redovisningsperiod }
}

/**
 * Load the AGI XML for a salary run from agi_declarations.xml_content
 * (built by app/api/salary/runs/[id]/agi/xml/route.ts via generateAGIXml).
 *
 * Returns the XML alongside the formatted arbetsgivare/period strings used
 * downstream by the granskningsunderlag and kvittenser endpoints.
 *
 * Skatteverket's POST /underlag accepts XML directly; we don't transform it
 * here, just plumb it through.
 */
async function loadAGIXml(
  request: Request,
  ctx: ExtensionContext,
): Promise<{
  arbetsgivare: string
  period: string
  salaryRunId: string
  xml: string
}> {
  const body = (await request.json()) as { salaryRunId?: string }
  const salaryRunId = body.salaryRunId
  if (!salaryRunId) {
    throw new Error('Saknar obligatoriskt fält: salaryRunId')
  }

  const { data: settings } = await ctx.supabase
    .from('company_settings')
    .select('org_number, entity_type')
    .eq('company_id', ctx.companyId)
    .single()

  if (!settings?.org_number) {
    throw new Error('Organisationsnummer saknas i företagsinställningar')
  }

  // Use the most recent agi_declarations row for this salary run — covers
  // both new declarations and corrections (which overwrite xml_content
  // in place per the existing /api/salary/runs/[id]/agi/xml route).
  const { data: declaration, error: declarationError } = await ctx.supabase
    .from('agi_declarations')
    .select('xml_content, period_year, period_month')
    .eq('company_id', ctx.companyId)
    .eq('salary_run_id', salaryRunId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (declarationError || !declaration?.xml_content) {
    throw new Error(
      'AGI-XML saknas. Generera AGI-filen från lönekörningen först (Lön → AGI → Generera).',
    )
  }

  const arbetsgivare = formatRedovisare(settings.org_number, settings.entity_type)
  const period = formatRedovisningsperiod('monthly', declaration.period_year, declaration.period_month)

  return { arbetsgivare, period, salaryRunId, xml: declaration.xml_content }
}

/**
 * Convert Skatteverket errors to appropriate HTTP responses.
 */
function handleSkvError(err: unknown): NextResponse {
  if (err instanceof SkatteverketAuthError) {
    const status = err.code === 'NOT_CONNECTED' ? 401
      : err.code === 'BEHORIGHET_SAKNAS' ? 403
      : err.code === 'SESSION_EXPIRED' || err.code === 'REFRESH_EXHAUSTED' ? 401
      : 403

    return NextResponse.json(
      { error: err.message, code: err.code },
      { status }
    )
  }

  console.error('[skatteverket] API error:', err)
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Okänt fel' },
    { status: 500 }
  )
}
