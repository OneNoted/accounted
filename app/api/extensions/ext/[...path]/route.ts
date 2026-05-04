import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ensureInitialized } from '@/lib/init'
import { extensionRegistry } from '@/lib/extensions/registry'
import { createExtensionContext } from '@/lib/extensions/context-factory'
import { requireCompanyId } from '@/lib/company/context'
import type { ApiRouteDefinition } from '@/lib/extensions/types'

ensureInitialized()

// Heavy extension routes (SIE import, migration) need up to 5 minutes
export const maxDuration = 300

/**
 * Per-extension runtime feature flags. Lets ops toggle an integration off
 * without redeploying or removing it from extensions.config.json — useful
 * for phased rollouts (dev tenants → design partners → general).
 *
 * The flag is checked on every request. If the env var is not exactly the
 * string "true", the dispatcher returns 503 with `code: 'EXTENSION_DISABLED'`.
 *
 * Server-side env vars only — no NEXT_PUBLIC_ prefix. Next.js inlines
 * NEXT_PUBLIC_* into the client bundle at build time, so a flip on Vercel
 * without a redeploy would create split-brain (server returns 503,
 * client still renders the enabled flow). UI panels detect the 503 by
 * response code, not by reading the flag directly.
 */
const EXTENSION_FEATURE_FLAGS: Record<string, { envVar: string; disabledMessage: string }> = {
  skatteverket: {
    envVar: 'SKATTEVERKET_ENABLED',
    disabledMessage: 'Skatteverket-integrationen är inte aktiverad i denna miljö.',
  },
}

/**
 * Match a request path against a route pattern.
 * Supports :param wildcards (e.g., /:id/confirm).
 * Returns extracted params on match, null on mismatch.
 */
function matchPath(
  pattern: string,
  requestPath: string
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const requestParts = requestPath.split('/').filter(Boolean)

  if (patternParts.length !== requestParts.length) return null

  const params: Record<string, string> = {}

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = requestParts[i]
    } else if (patternParts[i] !== requestParts[i]) {
      return null
    }
  }

  return params
}

/**
 * Catch-all route for extension-declared API routes.
 *
 * URL scheme: /api/extensions/ext/{extensionId}/{...routePath}
 * Example:    /api/extensions/ext/mcp-server/mcp → POST /mcp
 *
 * - Looks up the extension in the registry
 * - Checks the extension toggle (disabled → 403)
 * - Matches method + path pattern to registered apiRoutes
 * - Extracts path params and appends them as URL search params
 * - Builds an ExtensionContext and passes it to the handler
 */
async function handleRequest(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  const segments = await params

  if (!segments.path || segments.path.length < 1) {
    return NextResponse.json({ error: 'Invalid extension route' }, { status: 400 })
  }

  const [extensionId, ...rest] = segments.path
  const routePath = '/' + rest.join('/')
  const method = request.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

  // Look up extension
  const extension = extensionRegistry.get(extensionId)
  if (!extension || !extension.apiRoutes || extension.apiRoutes.length === 0) {
    return NextResponse.json({ error: 'Extension not found' }, { status: 404 })
  }

  // Per-extension feature flags. Lets us toggle a single integration off
  // mid-rollout without redeploying or removing it from extensions.config.json.
  // The frontend (SkatteverketPanel, AGIPanel) inspects the 503 + code to
  // render an "extension disabled" empty state.
  const flag = EXTENSION_FEATURE_FLAGS[extensionId]
  if (flag && process.env[flag.envVar] !== 'true') {
    return NextResponse.json(
      { error: flag.disabledMessage, code: 'EXTENSION_DISABLED' },
      { status: 503 },
    )
  }

  // Match route BEFORE auth so we can check skipAuth (e.g. OAuth callbacks)
  let matchedRoute: ApiRouteDefinition | null = null
  let extractedParams: Record<string, string> = {}

  for (const route of extension.apiRoutes) {
    if (route.method !== method) continue

    const routeParams = matchPath(route.path, routePath)
    if (routeParams !== null) {
      matchedRoute = route
      extractedParams = routeParams
      break
    }
  }

  if (!matchedRoute) {
    return NextResponse.json({ error: 'Route not found' }, { status: 404 })
  }

  // Config sanity check: these flags are orthogonal and the combination is
  // nonsensical. `skipAuth` already implies no company resolution, so adding
  // `skipCompanyContext: true` is at best redundant — and if a maintainer
  // intended "auth required, no company" but also wrote `skipAuth: true`,
  // the auth requirement would be silently dropped (skipAuth fires first
  // below). Fail loudly instead of masking the mistake.
  if (matchedRoute.skipAuth && matchedRoute.skipCompanyContext) {
    console.error('[extension-dispatcher] route misconfigured: skipAuth + skipCompanyContext are mutually exclusive', {
      extensionId,
      routePath,
      method,
    })
    return NextResponse.json({ error: 'Route misconfigured' }, { status: 500 })
  }

  // For skipAuth routes (e.g. OAuth callbacks from external providers),
  // skip user auth, toggle check, and AI consent — dispatch immediately
  if (matchedRoute.skipAuth) {
    let handlerRequest = request
    if (Object.keys(extractedParams).length > 0) {
      const url = new URL(request.url)
      for (const [key, value] of Object.entries(extractedParams)) {
        url.searchParams.set(`_${key}`, value)
      }
      const cloned = request.clone()
      handlerRequest = new Request(url.toString(), {
        method: cloned.method,
        headers: cloned.headers,
        body: cloned.body,
        // @ts-expect-error -- duplex needed for streaming body
        duplex: 'half',
      })
    }
    return matchedRoute.handler(handlerRequest)
  }

  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // If path params were extracted, create a new Request with them as search params
  let handlerRequest = request
  if (Object.keys(extractedParams).length > 0) {
    const url = new URL(request.url)
    for (const [key, value] of Object.entries(extractedParams)) {
      url.searchParams.set(`_${key}`, value)
    }
    // Clone first to avoid body stream locking issues when transferring to new Request
    const cloned = request.clone()
    handlerRequest = new Request(url.toString(), {
      method: cloned.method,
      headers: cloned.headers,
      body: cloned.body,
      // @ts-expect-error -- duplex needed for streaming body
      duplex: 'half',
    })
  }

  // Routes that are authenticated but run before a company exists (TIC
  // /lookup during onboarding, for example) opt out of company resolution.
  // Dispatch without a context — handlers that opt in must not rely on ctx.
  if (matchedRoute.skipCompanyContext) {
    return matchedRoute.handler(handlerRequest)
  }

  const companyId = await requireCompanyId(supabase, user.id)

  // Build context and dispatch
  const ctx = createExtensionContext(supabase, user.id, companyId, extensionId)
  return matchedRoute.handler(handlerRequest, ctx)
}

export const GET = handleRequest
export const POST = handleRequest
export const PUT = handleRequest
export const DELETE = handleRequest
export const PATCH = handleRequest
