import { renderToBuffer } from '@react-pdf/renderer'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse, errorResponseFromCode } from '@/lib/errors/get-structured-error'
import { buildArsredovisningData } from '@/lib/bokslut/arsredovisning/build-data'
import { ArsredovisningPDF } from '@/lib/bokslut/arsredovisning/arsredovisning-pdf'

export const GET = withRouteContext(
  'period.arsredovisning_pdf',
  async (_request, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const { supabase, companyId, log, requestId } = ctx
    try {
      const data = await buildArsredovisningData(supabase, companyId, id)
      const pdfBuffer = await renderToBuffer(ArsredovisningPDF({ data }))
      // "-utkast" suffix mirrors the existing PDF routes; the file becomes
      // "fastställd" only after the signature flow records all signatures.
      const filename = `arsredovisning-${data.fiscal_period.period_end}-utkast.pdf`
      return new Response(new Uint8Array(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${filename}"`,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (/not found/i.test(message)) {
        return errorResponseFromCode('PERIOD_NOT_FOUND', log, { requestId })
      }
      return errorResponse(err, log, { requestId })
    }
  },
)
