import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('health')

const CACHE_TTL_MS = 5_000

type CachedResult = {
  body: { status: 'healthy' | 'unhealthy'; timestamp: string; version: string }
  status: number
  expires: number
}

// In-memory cache shared across requests in the same process. Docker's
// healthcheck polls every 30 s, so the cache always returns fresh data to it,
// but a public flood (multiple requests/second) is served from RAM and never
// reaches Postgres. The cache is intentionally tiny — one entry — because the
// endpoint takes no parameters.
let cached: CachedResult | null = null

/**
 * GET /api/health
 * Public health check endpoint (no auth required).
 *
 * Error details are logged server-side only — never echoed to the response
 * body, which would expose Postgres error text on a public endpoint.
 *
 * Results are cached for {@link CACHE_TTL_MS} so flood traffic does not
 * hammer Postgres with a service-role query per request.
 */
export async function GET() {
  const now = Date.now()
  if (cached && cached.expires > now) {
    return NextResponse.json(cached.body, { status: cached.status })
  }

  const result = await runHealthCheck()
  cached = { ...result, expires: now + CACHE_TTL_MS }
  return NextResponse.json(result.body, { status: result.status })
}

async function runHealthCheck(): Promise<Omit<CachedResult, 'expires'>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    log.error('Missing Supabase configuration for health check')
    return {
      body: { status: 'unhealthy', timestamp: new Date().toISOString(), version: '1.0.0' },
      status: 503,
    }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { error } = await supabase
      .from('fiscal_periods')
      .select('id', { count: 'exact', head: true })
      .limit(1)

    if (error) {
      log.error('Database health check failed', error)
      return {
        body: { status: 'unhealthy', timestamp: new Date().toISOString(), version: '1.0.0' },
        status: 503,
      }
    }

    return {
      body: { status: 'healthy', timestamp: new Date().toISOString(), version: '1.0.0' },
      status: 200,
    }
  } catch (err) {
    log.error('Health check unexpected error', err)
    return {
      body: { status: 'unhealthy', timestamp: new Date().toISOString(), version: '1.0.0' },
      status: 503,
    }
  }
}
