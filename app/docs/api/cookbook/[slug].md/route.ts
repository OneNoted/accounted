import { NextResponse } from 'next/server'
import { findRecipe, buildPlaceholderMd } from '@/lib/docs/content/cookbook'
import { withPublicSecurityHeaders } from '@/lib/api/v1/security-headers'

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = findRecipe(slug)
  if (!entry) {
    return new NextResponse('Not found', { status: 404 })
  }
  const md = entry.markdown ?? buildPlaceholderMd(entry)
  return new NextResponse(md, {
    status: 200,
    headers: withPublicSecurityHeaders({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    }),
  })
}
