import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse, errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { validateBody } from '@/lib/api/validate'
import {
  getNarrative,
  upsertNarrative,
} from '@/lib/bokslut/arsredovisning/narrative-service'

const PostSchema = z.object({
  // Match the DB CHECK lengths exactly so a payload that would fail at the
  // storage layer instead returns a clean 400 here.
  description: z.string().max(4000).nullable().optional(),
  important_events: z.string().max(4000).nullable().optional(),
  resultatdisposition: z.string().max(2000).nullable().optional(),
})

export const GET = withRouteContext(
  'period.arsredovisning_narrative_get',
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, log, requestId } = ctx
    try {
      const data = await getNarrative(supabase, companyId, id)
      return NextResponse.json({ data })
    } catch (err) {
      return errorResponse(err, log, { requestId })
    }
  },
)

export const POST = withRouteContext(
  'period.arsredovisning_narrative_post',
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { user, supabase, companyId, log, requestId } = ctx
    const validation = await validateBody(request, PostSchema)
    if (!validation.success) return validation.response
    try {
      // Verify the fiscal period belongs to the authenticated company before
      // writing — defense-in-depth alongside RLS, gives a cleaner 404 than
      // the RLS rejection envelope.
      const { data: period } = await supabase
        .from('fiscal_periods')
        .select('id')
        .eq('id', id)
        .eq('company_id', companyId)
        .maybeSingle()
      if (!period) {
        return errorResponseFromCode('PERIOD_NOT_FOUND', log, { requestId })
      }
      const data = await upsertNarrative(supabase, companyId, user.id, id, validation.data)
      return NextResponse.json({ data })
    } catch (err) {
      return errorResponse(err, log, { requestId })
    }
  },
  { requireWrite: true },
)
