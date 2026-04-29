/**
 * Support recipient — server-side only.
 * Used by the /api/support/contact route. Never exposed to the client.
 *
 * Resolution order:
 *   SUPPORT_RECIPIENT_EMAIL (legacy)  →  branding service (BRANDING_SUPPORT_EMAIL or default)
 */
import { getBranding } from '@/lib/branding/service'

export const SUPPORT_RECIPIENT_EMAIL =
  process.env.SUPPORT_RECIPIENT_EMAIL || getBranding().supportEmail
