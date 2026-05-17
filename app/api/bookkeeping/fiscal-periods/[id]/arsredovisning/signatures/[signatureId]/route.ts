import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse } from '@/lib/errors/get-structured-error'
import { validateBody } from '@/lib/api/validate'
import { markSignatureSigned } from '@/lib/bokslut/arsredovisning/signature-service'

// PATCH transitions: pending → signed (manual entry for the paper / outside-
// BankID flow) or pending → declined. Real BankID wiring lands in a future
// phase and uses markSignatureSigned() the same way, just with the BankID
// callback as the trigger instead of a user action.
const PatchSchema = z.object({
  status: z.enum(['signed', 'declined']),
})

export const PATCH = withRouteContext(
  'period.arsredovisning_signature_patch',
  async (
    request,
    ctx,
    { params }: { params: Promise<{ id: string; signatureId: string }> },
  ) => {
    const { signatureId } = await params
    const { supabase, companyId, log, requestId } = ctx
    const validation = await validateBody(request, PatchSchema)
    if (!validation.success) return validation.response
    try {
      if (validation.data.status === 'signed') {
        const data = await markSignatureSigned(supabase, companyId, signatureId)
        return NextResponse.json({ data })
      }
      // declined — direct UPDATE (no helper since BankID flow doesn't
      // produce declined rows; this is a UI-only path)
      const { data, error } = await supabase
        .from('arsredovisning_signature_requests')
        .update({ status: 'declined' })
        .eq('id', signatureId)
        .eq('company_id', companyId)
        .select('*')
        .single()
      if (error || !data) {
        throw new Error(`Failed to mark signature declined: ${error?.message ?? 'unknown'}`)
      }
      return NextResponse.json({ data })
    } catch (err) {
      return errorResponse(err, log, { requestId })
    }
  },
  { requireWrite: true },
)
