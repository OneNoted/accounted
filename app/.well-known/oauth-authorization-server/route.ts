import { NextResponse } from 'next/server'
import { ALL_SCOPES } from '@/lib/auth/api-keys'

/**
 * RFC 8414 — OAuth 2.0 Authorization Server Metadata.
 * Tells MCP clients where the authorize/token endpoints are.
 */
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  return NextResponse.json({
    issuer: appUrl,
    authorization_endpoint: `${appUrl}/api/mcp-oauth/authorize`,
    token_endpoint: `${appUrl}/api/mcp-oauth/token`,
    registration_endpoint: `${appUrl}/api/mcp-oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    // Advertise the full scope list so MCP clients (and self-hosted apps)
    // can build a `scope` request param. `mcp` remains valid as a
    // coarse-grained marker — the authorize endpoint accepts both.
    scopes_supported: ['mcp', ...ALL_SCOPES],
  })
}
