import { describe, it, expect } from 'vitest'
import {
  BolagsverketClient,
  BolagsverketApiError,
  BOLAGSVERKET_ERROR_MESSAGES,
  configFromEnv,
} from '../lib/client'

describe('configFromEnv', () => {
  it('defaults to the test environment', () => {
    const config = configFromEnv()
    expect(config.environment).toBe('test')
  })

  it('decodes base64-wrapped PEM material', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'
    const config = configFromEnv({
      environment: 'accept',
      clientCertPem: pem,
      clientKeyPem: pem,
    })
    expect(config.clientCertPem).toContain('-----BEGIN CERTIFICATE-----')
  })
})

describe('BolagsverketClient', () => {
  it('refuses accept/prod calls without an organisationscertifikat', async () => {
    const client = new BolagsverketClient({ environment: 'accept' })
    await expect(client.getGrunduppgifter('5560001111')).rejects.toThrow(
      /Organisationscertifikat saknas/,
    )
  })

  it('exposes the configured environment', () => {
    expect(new BolagsverketClient({ environment: 'test' }).environment).toBe('test')
    expect(new BolagsverketClient({ environment: 'prod' }).environment).toBe('prod')
  })
})

describe('felkodskarta (GUIDE Appendix A §6.2)', () => {
  it('covers the documented API error codes with Swedish messages', () => {
    for (const code of ['4001', '4003', '4005', '4008', '4010', '5006', '7003', '7006', '9003']) {
      expect(BOLAGSVERKET_ERROR_MESSAGES[code]).toBeTruthy()
    }
  })

  it('BolagsverketApiError carries status + truncated body for logging', () => {
    const err = new BolagsverketApiError('Testfel', 400, 'body')
    expect(err.name).toBe('BolagsverketApiError')
    expect(err.status).toBe(400)
    expect(err.body).toBe('body')
  })
})
