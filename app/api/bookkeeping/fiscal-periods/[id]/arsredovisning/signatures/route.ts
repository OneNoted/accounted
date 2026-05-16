import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse } from '@/lib/errors/get-structured-error'
import { validateBody } from '@/lib/api/validate'
import {
  createSignatureRequest,
  listSignatureRequests,
} from '@/lib/bokslut/arsredovisning/signature-service'

const CreateSchema = z.object({
  role: z.string().min(1),
  signer_name: z.string().min(1),
})

export const GET = withRouteContext(
  'period.arsredovisning_signatures_list',
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, log, requestId } = ctx
    try {
      const data = await listSignatureRequests(supabase, companyId, id)
      return NextResponse.json({ data })
    } catch (err) {
      return errorResponse(err, log, { requestId })
    }
  },
)

export const POST = withRouteContext(
  'period.arsredovisning_signatures_create',
  async (request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { user, supabase, companyId, log, requestId } = ctx
    const validation = await validateBody(request, CreateSchema)
    if (!validation.success) return validation.response
    try {
      const data = await createSignatureRequest(supabase, companyId, user.id, id, validation.data)
      return NextResponse.json({ data })
    } catch (err) {
      return errorResponse(err, log, { requestId })
    }
  },
  { requireWrite: true },
)
