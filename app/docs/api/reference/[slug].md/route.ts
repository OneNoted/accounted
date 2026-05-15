import { NextResponse } from 'next/server'
import { buildResourcePages } from '@/lib/docs/content/reference'
import { withPublicSecurityHeaders } from '@/lib/api/v1/security-headers'

// Next.js 16 does not extract the dynamic segment name from a directory
// like `[slug].md/` — the literal `.md` suffix breaks the inference and
// the framework types `params` as `{}`. Workaround: parse the slug from
// request.url.pathname directly. Routing still works (Next.js still
// matches /docs/api/reference/foo.md to this handler) — only the
// `params` typing is unusable.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const match = url.pathname.match(/\/reference\/([^/]+)\.md$/)
  const slug = match?.[1]
  if (!slug) return new NextResponse('Not found', { status: 404 })

  const page = buildResourcePages().find((p) => p.slug === slug)
  if (!page) return new NextResponse('Not found', { status: 404 })

  return new NextResponse(page.markdown, {
    status: 200,
    headers: withPublicSecurityHeaders({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    }),
  })
}
