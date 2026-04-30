import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { cleanupExpiredIdempotencyKeys } from '@/lib/api/idempotency'

/**
 * GET /api/idempotency/cleanup/cron
 *
 * Sweeps idempotency_keys rows past their 24h TTL. Cron runs hourly so the
 * working set stays small even under heavy agent retry traffic.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = await createServiceClient()
    const deleted = await cleanupExpiredIdempotencyKeys(supabase)
    console.log(`Idempotency keys cleanup completed: ${deleted} rows removed`)
    return NextResponse.json({ success: true, deleted })
  } catch (error) {
    console.error('Error in idempotency cleanup cron:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clean up idempotency keys' },
      { status: 500 }
    )
  }
}
