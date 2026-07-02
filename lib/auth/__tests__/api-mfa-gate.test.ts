import { describe, it, expect } from 'vitest'
import { apiPathSkipsMfaGate } from '@/lib/auth/api-mfa-gate'

describe('apiPathSkipsMfaGate', () => {
  it('skips the gate for any Bearer-authenticated request (API key / cron / webhook)', () => {
    // A dashboard data route that WOULD be gated when cookie-authed is skipped
    // once an Authorization header is present.
    expect(apiPathSkipsMfaGate('/api/bookkeeping/journal-entries/123', true)).toBe(true)
    expect(apiPathSkipsMfaGate('/api/v1/companies/abc/invoices', true)).toBe(true)
    expect(apiPathSkipsMfaGate('/api/reports/full-archive', true)).toBe(true)
  })

  it('skips the gate for the AAL1 escape-hatch and OAuth routes', () => {
    expect(apiPathSkipsMfaGate('/api/account/password', false)).toBe(true)
    expect(apiPathSkipsMfaGate('/api/account/set-password', false)).toBe(true)
    expect(apiPathSkipsMfaGate('/api/company', false)).toBe(true)
    expect(apiPathSkipsMfaGate('/api/company/members', false)).toBe(true)
    expect(apiPathSkipsMfaGate('/api/mcp-oauth/authorize', false)).toBe(true)
    expect(apiPathSkipsMfaGate('/api/mcp-oauth/token', false)).toBe(true)
  })

  it('gates cookie-authenticated calls to sensitive dashboard routes', () => {
    expect(apiPathSkipsMfaGate('/api/bookkeeping/journal-entries/123', false)).toBe(false)
    expect(apiPathSkipsMfaGate('/api/salary/employees/1', false)).toBe(false)
    expect(apiPathSkipsMfaGate('/api/reports/full-archive', false)).toBe(false)
    expect(apiPathSkipsMfaGate('/api/documents/1', false)).toBe(false)
  })

  it('does not let a lookalike prefix bypass the account/company allowlist', () => {
    // "/api/accounts" (plural, a different resource) must NOT match the
    // "/api/account/" escape hatch.
    expect(apiPathSkipsMfaGate('/api/accounts', false)).toBe(false)
    expect(apiPathSkipsMfaGate('/api/account', false)).toBe(false)
  })
})
