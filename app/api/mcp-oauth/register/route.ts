import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { isAllowedRedirectUri } from '@/lib/auth/oauth-allowlist'

/**
 * RFC 7591 — Dynamic Client Registration.
 *
 * Claude Desktop and self-hosted MCP clients register themselves before
 * starting the auth flow. The redirect URIs they declare are validated
 * against built-in patterns (Claude/localhost) and the user-managed
 * oauth_client_registrations table (self-hosted custom apps).
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : []
  for (const uri of redirectUris) {
    if (typeof uri !== 'string' || !(await isAllowedRedirectUri(uri))) {
      return NextResponse.json(
        { error: 'invalid_redirect_uri', error_description: `Redirect URI not allowed: ${uri}` },
        { status: 400 }
      )
    }
  }

  const clientId = crypto.randomUUID()

  return NextResponse.json({
    client_id: clientId,
    client_name: (body.client_name as string) || 'MCP Client',
    redirect_uris: redirectUris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, { status: 201 })
}
