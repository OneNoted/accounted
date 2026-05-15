import { NextResponse } from 'next/server'
import { buildResourcePages } from '@/lib/docs/content/reference'
import { withPublicSecurityHeaders } from '@/lib/api/v1/security-headers'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = buildResourcePages().find((p) => p.slug === slug)
  if (!page) {
    return new NextResponse('Not found', { status: 404 })
  }
  return new NextResponse(page.markdown, {
    status: 200,
    headers: withPublicSecurityHeaders({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    }),
  })
}
