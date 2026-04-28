import crypto from 'crypto'
import type { Extension, ExtensionContext } from '@/lib/extensions/types'
import { NextResponse } from 'next/server'
import { TimeoutError } from '@/lib/http/fetch-with-timeout'
import { buildAuthorizeUrl, exchangeCodeForTokens } from './lib/oauth'
import { storeTokens, getTokens, deleteTokens } from './lib/token-store'
import { skvRequest, SkatteverketAuthError } from './lib/api-client'
import { rutorToMomsuppgift, formatRedovisare, formatRedovisningsperiod } from './lib/mappers'
import { calculateVatDeclaration } from '@/lib/reports/vat-declaration'
import { agiSaveDraft, agiValidate, agiGetSubmission, agiDeleteDraft, agiLockPeriod, agiUnlockPeriod, agiGetSubmitted } from './lib/agi-client'
import { buildAGIPayload } from './lib/agi-mappers'
import type { AGIEmployeeData, AGITotals } from '@/lib/salary/agi/xml-generator'
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

        // Store state for CSRF validation in callback
        await ctx.settings.set('oauth_state', state)
        await ctx.settings.set('oauth_redirect_uri', redirectUri)

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

        try {
          const tokens = await exchangeCodeForTokens(code, redirectUri)
          await storeTokens(supabase, user.id, tokens, companyId)

          // Clean up CSRF state
          await supabase
            .from('extension_data')
            .delete()
            .eq('company_id', companyId)
            .eq('extension_id', 'skatteverket')
            .eq('key', 'oauth_state')

          return NextResponse.redirect(
            `${appUrl}/reports?tab=vat-declaration&skv_connected=true`
          )
        } catch (err) {
          console.error('[skatteverket] Token exchange failed:', err)
          // BankID auth codes expire after 5 minutes. Surface timeouts distinctly
          // so the user retries quickly instead of exhausting the code window.
          const message = err instanceof TimeoutError
            ? 'Tidsgränsen mot Skatteverket överskreds — försök igen med BankID'
            : err instanceof Error
              ? err.message
              : 'Token exchange misslyckades'
          return NextResponse.redirect(
            `${appUrl}/reports?tab=vat-declaration&skv_error=${encodeURIComponent(message)}`
          )
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
    // ══════════════════════════════════════════════════════════════

    // ── AGI: Validate (dry run) ────────────────────────────────────
    {
      method: 'POST',
      path: '/agi/validate',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { arbetsgivare, period, payload } = await parseAGIRequest(request, ctx)

          console.log('[skatteverket] AGI validating:', { arbetsgivare, period })

          const result = await agiValidate(ctx.supabase, ctx.companyId, arbetsgivare, period, payload)

          if (!result.ok) {
            console.error('[skatteverket] AGI validate error:', result.status, result.error)
            return NextResponse.json(
              { error: `Skatteverket svarade med ${result.status}: ${result.error}` },
              { status: result.status }
            )
          }

          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Save draft ────────────────────────────────────────────
    {
      method: 'POST',
      path: '/agi/draft',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const { arbetsgivare, period, payload, salaryRunId } = await parseAGIRequest(request, ctx)

          console.log('[skatteverket] AGI saving draft:', { arbetsgivare, period })

          const result = await agiSaveDraft(ctx.supabase, ctx.companyId, arbetsgivare, period, payload)

          if (!result.ok) {
            console.error('[skatteverket] AGI draft error:', result.status, result.error)
            return NextResponse.json(
              { error: `Skatteverket svarade med ${result.status}: ${result.error}` },
              { status: result.status }
            )
          }

          // Track submission status and inlämningsId
          const inlamningId = result.data?.inlamningId
          await ctx.settings.set(
            `agi_submission_${period}`,
            JSON.stringify({
              status: 'draft_saved',
              arbetsgivare,
              period,
              inlamningId,
              salaryRunId,
              kontrollresultat: result.data?.kontrollresultat,
              updatedAt: new Date().toISOString(),
            })
          )

          // Update agi_declarations table with submission status
          if (salaryRunId) {
            await ctx.supabase
              .from('agi_declarations')
              .update({ status: 'exported' })
              .eq('salary_run_id', salaryRunId)
              .eq('company_id', ctx.companyId)
          }

          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Get submission ────────────────────────────────────────
    {
      method: 'GET',
      path: '/agi/submission',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const url = new URL(request.url)
          const arbetsgivare = url.searchParams.get('arbetsgivare')
          const period = url.searchParams.get('period')
          const inlamningId = url.searchParams.get('inlamningId')

          if (!arbetsgivare || !period || !inlamningId) {
            return NextResponse.json(
              { error: 'Saknar parametrar: arbetsgivare, period, inlamningId' },
              { status: 400 }
            )
          }

          const result = await agiGetSubmission(ctx.supabase, ctx.companyId, arbetsgivare, period, inlamningId)

          if (!result.ok) {
            return NextResponse.json(
              { error: `Skatteverket svarade med ${result.status}: ${result.error}` },
              { status: result.status }
            )
          }

          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Delete draft ──────────────────────────────────────────
    {
      method: 'DELETE',
      path: '/agi/draft',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        try {
          const url = new URL(request.url)
          const arbetsgivare = url.searchParams.get('arbetsgivare')
          const period = url.searchParams.get('period')
          const inlamningId = url.searchParams.get('inlamningId')

          if (!arbetsgivare || !period || !inlamningId) {
            return NextResponse.json(
              { error: 'Saknar parametrar: arbetsgivare, period, inlamningId' },
              { status: 400 }
            )
          }

          const result = await agiDeleteDraft(ctx.supabase, ctx.companyId, arbetsgivare, period, inlamningId)

          if (!result.ok) {
            return NextResponse.json(
              { error: `Skatteverket svarade med ${result.status}: ${result.error}` },
              { status: result.status }
            )
          }

          await ctx.settings.set(`agi_submission_${period}`, null)
          return NextResponse.json({ success: true })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Lock period for signing ───────────────────────────────
    {
      method: 'PUT',
      path: '/agi/lock',
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
              { status: 400 }
            )
          }

          const result = await agiLockPeriod(ctx.supabase, ctx.companyId, arbetsgivare, period)

          if (!result.ok) {
            return NextResponse.json(
              { error: `Skatteverket svarade med ${result.status}: ${result.error}` },
              { status: result.status }
            )
          }

          await ctx.settings.set(
            `agi_submission_${period}`,
            JSON.stringify({
              status: 'draft_locked',
              arbetsgivare,
              period,
              signeringslank: result.data?.signeringslank,
              updatedAt: new Date().toISOString(),
            })
          )

          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Unlock period ─────────────────────────────────────────
    {
      method: 'DELETE',
      path: '/agi/lock',
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
              { status: 400 }
            )
          }

          const result = await agiUnlockPeriod(ctx.supabase, ctx.companyId, arbetsgivare, period)

          if (!result.ok) {
            return NextResponse.json(
              { error: `Skatteverket svarade med ${result.status}: ${result.error}` },
              { status: result.status }
            )
          }

          await ctx.settings.set(
            `agi_submission_${period}`,
            JSON.stringify({
              status: 'draft_saved',
              arbetsgivare,
              period,
              updatedAt: new Date().toISOString(),
            })
          )

          return NextResponse.json({ success: true })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Fetch submitted (after BankID signing) ────────────────
    {
      method: 'GET',
      path: '/agi/submitted',
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
              { status: 400 }
            )
          }

          const result = await agiGetSubmitted(ctx.supabase, ctx.companyId, arbetsgivare, period)

          if (!result.ok) {
            return NextResponse.json(
              { error: `Skatteverket svarade med ${result.status}: ${result.error}` },
              { status: result.status }
            )
          }

          // If we got a kvittensnummer, the AGI has been signed and submitted
          if (result.data?.kvittensnummer) {
            await ctx.settings.set(
              `agi_submission_${period}`,
              JSON.stringify({
                status: 'signed',
                arbetsgivare,
                period,
                kvittensnummer: result.data.kvittensnummer,
                tidpunkt: result.data.tidpunkt,
                signerare: result.data.signerare,
                updatedAt: new Date().toISOString(),
              })
            )

            // Update agi_declarations with submission receipt
            const periodYear = parseInt(period.slice(0, 4))
            const periodMonth = parseInt(period.slice(4, 6))
            await ctx.supabase
              .from('agi_declarations')
              .update({
                status: 'submitted',
                kvittensnummer: result.data.kvittensnummer,
                submitted_at: result.data.tidpunkt || new Date().toISOString(),
                submitted_by: ctx.userId,
              })
              .eq('company_id', ctx.companyId)
              .eq('period_year', periodYear)
              .eq('period_month', periodMonth)
          }

          return NextResponse.json({ data: result.data })
        } catch (err) {
          return handleSkvError(err)
        }
      },
    },

    // ── AGI: Get submission status (local tracking) ────────────────
    {
      method: 'GET',
      path: '/agi/status',
      handler: async (request: Request, ctx?: ExtensionContext) => {
        if (!ctx) {
          return NextResponse.json({ error: 'Extension context required' }, { status: 500 })
        }

        const url = new URL(request.url)
        const period = url.searchParams.get('period')

        if (!period) {
          return NextResponse.json({ error: 'Saknar parameter: period' }, { status: 400 })
        }

        const statusJson = await ctx.settings.get<string>(`agi_submission_${period}`)
        if (!statusJson) {
          return NextResponse.json({ data: null })
        }

        try {
          return NextResponse.json({ data: JSON.parse(statusJson) })
        } catch {
          return NextResponse.json({ data: null })
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
 * Parse and validate AGI submission request body.
 * Loads salary run data and builds the Skatteverket AGI JSON payload.
 */
async function parseAGIRequest(
  request: Request,
  ctx: ExtensionContext
): Promise<{
  arbetsgivare: string
  period: string
  payload: ReturnType<typeof buildAGIPayload>
  salaryRunId: string
}> {
  const body = await request.json()
  const { salaryRunId } = body as { salaryRunId: string }

  if (!salaryRunId) {
    throw new Error('Saknar obligatoriskt fält: salaryRunId')
  }

  // Get company settings for arbetsgivare formatting
  const { data: settings } = await ctx.supabase
    .from('company_settings')
    .select('org_number, entity_type')
    .eq('company_id', ctx.companyId)
    .single()

  if (!settings?.org_number) {
    throw new Error('Organisationsnummer saknas i företagsinställningar')
  }

  // Load salary run
  const { data: run, error: runError } = await ctx.supabase
    .from('salary_runs')
    .select('*')
    .eq('id', salaryRunId)
    .eq('company_id', ctx.companyId)
    .single()

  if (runError || !run) {
    throw new Error('Lönekörning hittades inte')
  }

  if (!['review', 'approved', 'paid', 'booked'].includes(run.status)) {
    throw new Error('AGI kan bara skickas efter granskning')
  }

  // Load employees with their data
  const { data: runEmployees } = await ctx.supabase
    .from('salary_run_employees')
    .select('*, employee:employees(personnummer, specification_number, f_skatt_status), line_items:salary_line_items(*)')
    .eq('salary_run_id', salaryRunId)

  if (!runEmployees || runEmployees.length === 0) {
    throw new Error('Inga anställda i lönekörningen')
  }

  // Build employee data
  const employeeData: AGIEmployeeData[] = runEmployees.map(sre => {
    const emp = sre.employee as { personnummer: string; specification_number: number; f_skatt_status: string } | null
    const lineItems = (sre.line_items || []) as Array<Record<string, unknown>>

    const sumByType = (types: string[]) =>
      lineItems
        .filter(li => types.includes(li.item_type as string))
        .reduce((sum, li) => sum + ((li.amount as number) || 0), 0)

    return {
      personnummer: emp?.personnummer || '',
      specificationNumber: emp?.specification_number || 0,
      grossSalary: sre.gross_salary,
      taxWithheld: sre.tax_withheld,
      avgifterBasis: sre.avgifter_basis,
      fSkattPayment: emp?.f_skatt_status === 'f_skatt' ? sre.gross_salary : undefined,
      benefitCar: sumByType(['benefit_car']) || undefined,
      benefitHousing: sumByType(['benefit_housing']) || undefined,
      benefitMeals: sumByType(['benefit_meals']) || undefined,
      benefitOther: sumByType(['benefit_wellness', 'benefit_other']) || undefined,
      sickDays: sre.sick_days > 0 ? sre.sick_days : undefined,
      vabDays: sre.vab_days > 0 ? sre.vab_days : undefined,
      parentalDays: sre.parental_days > 0 ? sre.parental_days : undefined,
    }
  })

  // Build totals with avgifter breakdown by category
  const avgifterByCategory: AGITotals['avgifterByCategory'] = {}
  for (const sre of runEmployees) {
    const dbCategory = sre.avgifter_category as string | null
    const category = dbCategory
      ? (dbCategory === 'reduced_65plus' ? 'reduced65plus' : dbCategory === 'vaxa_stod' ? 'standard' : dbCategory)
      : (sre.avgifter_rate <= 0.1022 ? 'reduced65plus' : sre.avgifter_rate <= 0.2082 ? 'youth' : 'standard')
    const cat = avgifterByCategory[category as keyof typeof avgifterByCategory] || { basis: 0, amount: 0 }
    cat.basis += sre.avgifter_basis
    cat.amount += sre.avgifter_amount
    ;(avgifterByCategory as Record<string, { basis: number; amount: number }>)[category] = cat
  }

  const totalAvgifterAmount = Object.values(avgifterByCategory).reduce(
    (sum, cat) => sum + (cat?.amount ?? 0),
    0
  )

  // FK499 — sjuklönekostnad summed from sick_day2_14 line items
  let totalSjuklonekostnad = 0
  for (const sre of runEmployees) {
    const lineItems = (sre.line_items || []) as Array<Record<string, unknown>>
    for (const li of lineItems) {
      if (li.item_type === 'sick_day2_14') {
        totalSjuklonekostnad += Math.abs((li.amount as number) || 0)
      }
    }
  }

  const totals: AGITotals = {
    totalTax: run.total_tax,
    totalAvgifterBasis: runEmployees.reduce((s: number, e: { avgifter_basis: number }) => s + e.avgifter_basis, 0),
    totalAvgifterAmount: Math.round(totalAvgifterAmount * 100) / 100,
    totalSjuklonekostnad: Math.round(totalSjuklonekostnad * 100) / 100,
    avgifterByCategory,
  }

  // Check if this is a correction
  const { data: existingAgi } = await ctx.supabase
    .from('agi_declarations')
    .select('id, status')
    .eq('company_id', ctx.companyId)
    .eq('period_year', run.period_year)
    .eq('period_month', run.period_month)
    .in('status', ['submitted', 'accepted'])
    .single()

  const isCorrection = !!existingAgi

  const arbetsgivare = formatRedovisare(settings.org_number, settings.entity_type)
  const period = formatRedovisningsperiod('monthly', run.period_year, run.period_month)
  const payload = buildAGIPayload(employeeData, totals, isCorrection)

  return { arbetsgivare, period, payload, salaryRunId }
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
