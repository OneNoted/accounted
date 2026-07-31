import { describe, it, expect, vi, afterEach } from 'vitest'
import { isMfaRequired, shouldEnforceMfa } from '../mfa'

describe('mfa helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('isMfaRequired', () => {
    it('returns true when explicitly required in self-hosted mode', () => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true')
      vi.stubEnv('NEXT_PUBLIC_REQUIRE_MFA', 'true')
      expect(isMfaRequired()).toBe(true)
    })

    it('returns true when hosted and MFA required', () => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'false')
      vi.stubEnv('NEXT_PUBLIC_REQUIRE_MFA', 'true')
      expect(isMfaRequired()).toBe(true)
    })

    it.each([undefined, 'false'])('returns false in self-hosted mode when REQUIRE_MFA is %s', (value) => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true')
      vi.stubEnv('NEXT_PUBLIC_REQUIRE_MFA', value)
      expect(isMfaRequired()).toBe(false)
    })

    it.each([undefined, 'false'])('returns false in hosted mode when REQUIRE_MFA is %s', (value) => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'false')
      vi.stubEnv('NEXT_PUBLIC_REQUIRE_MFA', value)
      expect(isMfaRequired()).toBe(false)
    })
  })

  describe('shouldEnforceMfa', () => {
    it('returns false when MFA is not required', () => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true')
      expect(shouldEnforceMfa({ app_metadata: {} })).toBe(false)
    })

    it('returns false when user has bankid_linked', () => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'false')
      vi.stubEnv('NEXT_PUBLIC_REQUIRE_MFA', 'true')
      expect(shouldEnforceMfa({ app_metadata: { bankid_linked: true } })).toBe(false)
    })

    it('returns true when MFA required and no bankid', () => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'false')
      vi.stubEnv('NEXT_PUBLIC_REQUIRE_MFA', 'true')
      expect(shouldEnforceMfa({ app_metadata: {} })).toBe(true)
    })

    it('returns true when app_metadata is undefined', () => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'false')
      vi.stubEnv('NEXT_PUBLIC_REQUIRE_MFA', 'true')
      expect(shouldEnforceMfa({})).toBe(true)
    })
  })
})
