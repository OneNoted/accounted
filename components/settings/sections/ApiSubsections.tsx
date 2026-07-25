'use client'

import { ApiKeysPanel } from '@/components/settings/ApiKeysPanel'
import { OAuthClientsPanel } from '@/components/settings/OAuthClientsPanel'

/**
 * API settings decomposed into standalone subsections so the settings sheet
 * can render them as accordion panels (Dragspelet) while the legacy full
 * section component composes the same pieces. One implementation, two
 * layouts: the sheet and the section view can never drift.
 */

/** API keys (gnubok_sk_): create/revoke keys, scopes, and the MCP client
 *  connect instructions (Claude, Claude Code, Claude Desktop), which live
 *  inside ApiKeysPanel itself. */
export function ApiKeysSettings() {
  return <ApiKeysPanel />
}

/** OAuth clients: register and manage OAuth applications. */
export function ApiOAuthClientsSettings() {
  return <OAuthClientsPanel />
}
