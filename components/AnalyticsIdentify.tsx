'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'
import { isAnalyticsEnabled } from '@/lib/analytics/enabled'
import {
  buildPersonProperties,
  buildGroupProperties,
  type AnalyticsCompanyInput,
  type AnalyticsUserInput,
} from '@/lib/analytics/properties'

/**
 * Attaches the logged-in user and their active company to PostHog.
 *
 * Mounted from app/(dashboard)/layout.tsx, which is the only place that has
 * both the auth user and the resolved company in one render, and gated there
 * on `!isSandbox` so demo companies never pollute funnels or get surveyed.
 *
 * identify() runs on every dashboard load rather than only at login, per
 * PostHog's guidance: with `persistence: 'memory'` (see
 * instrumentation-client.ts) nothing survives a hard reload, so re-identifying
 * on each load is what keeps person-level analytics correct without storing
 * anything on the device.
 *
 * A useEffect is correct here despite the general rule against it: this
 * synchronises with an external, non-React system (the PostHog SDK).
 */
export default function AnalyticsIdentify({
  user,
  company,
}: {
  user: AnalyticsUserInput
  company: AnalyticsCompanyInput
}) {
  const { userId, email, fullName, role } = user
  const {
    id: companyId,
    name: companyName,
    entityType,
    accountingFramework,
    paysSalaries,
    trialEndsAt,
    capabilities,
  } = company

  // The dashboard layout rebuilds the props objects (and the capabilities
  // array) on every render, so depending on them directly would re-fire
  // identify on every navigation. Depend on primitives, and collapse the
  // array to a stable string key.
  const capabilityKey = capabilities ? [...capabilities].sort().join(',') : ''

  useEffect(() => {
    if (!isAnalyticsEnabled()) return

    posthog.identify(userId, buildPersonProperties({ userId, email, fullName, role }))
    posthog.group(
      'company',
      companyId,
      buildGroupProperties({
        id: companyId,
        name: companyName,
        entityType,
        accountingFramework,
        paysSalaries,
        trialEndsAt,
        capabilities: capabilityKey ? capabilityKey.split(',') : undefined,
      })
    )
  }, [
    userId,
    email,
    fullName,
    role,
    companyId,
    companyName,
    entityType,
    accountingFramework,
    paysSalaries,
    trialEndsAt,
    capabilityKey,
  ])

  return null
}
