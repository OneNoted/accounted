import { NextResponse } from 'next/server'
import { findRecipe, buildPlaceholderMd } from '@/lib/docs/content/cookbook'
import { withPublicSecurityHeaders } from '@/lib/api/v1/security-headers'

// Next.js 16 does not extract the dynamic segment name from a directory
// like `[slug].md/` — the literal `.md` suffix breaks the inference and
// the framework types `params` as `{}`. Workaround: parse the slug from
// request.url.pathname directly. Routing still works (Next.js still
// matches /docs/api/cookbook/foo.md to this handler) — only the
// `params` typing is unusable.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const match = url.pathname.match(/\/cookbook\/([^/]+)\.md$/)
  const slug = match?.[1]
  if (!slug) return new NextResponse('Not found', { status: 404 })

  const entry = findRecipe(slug)
  if (!entry) return new NextResponse('Not found', { status: 404 })

  const md = entry.markdown ?? buildPlaceholderMd(entry)
  return new NextResponse(md, {
    status: 200,
    headers: withPublicSecurityHeaders({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    }),
  })
}
