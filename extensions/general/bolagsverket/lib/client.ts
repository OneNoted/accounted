/**
 * Typed HTTP client for Bolagsverket's digital-inlämning REST services.
 *
 * Environments + endpoints per Anslutningsanvisning v1.7 §3:
 *   - test    → https://api-accept2.bolagsverket.se/testapi/…   (no client cert;
 *               static data, orgnr 1234567890/1234567891; requires firewall
 *               opening ordered via api@bolagsverket.se)
 *   - accept  → https://api-accept2.bolagsverket.se/…           (mTLS)
 *   - prod    → https://api.bolagsverket.se/…                   (mTLS)
 *
 * mTLS uses an Expisoft/Steria organisationscertifikat whose SERIALNUMBER is
 * `16` + the supplier's 10-digit orgnr (ANSLUTNINGSANVISNING §5.3). Cert/key
 * come from env vars on hosted; self-hosted operators supply their own via
 * extension settings. Implemented with node:https (undici fetch has no
 * portable client-cert support inside Next.js route handlers).
 */

import { request as httpsRequest, type RequestOptions } from 'node:https'
import { URL } from 'node:url'
import type {
  ArendestatusSvar,
  BolagsverketEnvironment,
  GrunduppgifterSvar,
  HamtaHandelserSvar,
  HandlingTyp,
  InlamningSvar,
  InlamningTokenSvar,
  KontrolleraSvar,
  KontrollsummaSvar,
} from '../types'

const HOSTS: Record<BolagsverketEnvironment, { base: string; prefix: string }> = {
  test: { base: 'https://api-accept2.bolagsverket.se', prefix: '/testapi' },
  accept: { base: 'https://api-accept2.bolagsverket.se', prefix: '' },
  prod: { base: 'https://api.bolagsverket.se', prefix: '' },
}

/** API felkoder (GUIDE Appendix A §6.2) → user-facing Swedish messages. */
export const BOLAGSVERKET_ERROR_MESSAGES: Record<string, string> = {
  '4001': 'Dokumentet är inte en giltig iXBRL-fil.',
  '4002': 'Programvaruversionen stöds inte längre av Bolagsverkets tjänst.',
  '4003': 'Ogiltigt organisationsnummer.',
  '4004': 'Organisationsnumret avser inte ett aktiebolag.',
  '4005': 'Ingen träff på organisationsnumret hos Bolagsverket.',
  '4007': 'Ogiltigt personnummer.',
  '4008': 'Filen innehåller ett eller flera tekniska fel.',
  '4010': 'Årsredovisningen är upprättad i en taxonomiversion som Bolagsverket inte längre stödjer.',
  '4011': 'Tjänsten stödjer inte den här företagsformen.',
  '5001': 'Dokumentet saknar eller har tom title-tagg.',
  '5002': 'Dokumentet är inte en iXBRL-fil.',
  '5006': 'Dokumentet överstiger tillåten maxstorlek (5 MB).',
  '5008': 'Dokumentet är inte kodat i UTF-8.',
  '5009': 'Dokumentet saknar taggning av programvara och/eller programversion.',
  '7003': 'Felaktig token — skapa en ny inlämningstoken och försök igen.',
  '7004': 'Dokumentet innehåller skadlig kod.',
  '7006': 'Årsredovisningen kan inte skickas in eftersom företaget är avvecklat.',
  '7007': 'Tjänsten stödjer inte digital inlämning för den här företagsformen.',
  '9003': 'Icke godkänd användare av tjänsten — kontrollera certifikat och avtal med Bolagsverket.',
}

export class BolagsverketApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message)
    this.name = 'BolagsverketApiError'
  }
}

export interface BolagsverketClientConfig {
  environment: BolagsverketEnvironment
  /** PEM strings — required for accept/prod, ignored for test. */
  clientCertPem?: string | null
  clientKeyPem?: string | null
  /** Extra CA chain (TeliaSonera root is normally in the system store). */
  caPem?: string | null
  timeoutMs?: number
}

/** Resolve config from env vars; extension settings may override per install. */
export function configFromEnv(
  overrides: Partial<BolagsverketClientConfig> = {},
): BolagsverketClientConfig {
  const environment = (overrides.environment ??
    process.env.BOLAGSVERKET_ENV ??
    'test') as BolagsverketEnvironment
  const decode = (value: string | undefined | null): string | null => {
    if (!value) return null
    // Allow base64-wrapped PEM in env vars (newline-hostile platforms).
    return value.includes('-----BEGIN')
      ? value
      : Buffer.from(value, 'base64').toString('utf8')
  }
  return {
    environment,
    clientCertPem: overrides.clientCertPem ?? decode(process.env.BOLAGSVERKET_CLIENT_CERT),
    clientKeyPem: overrides.clientKeyPem ?? decode(process.env.BOLAGSVERKET_CLIENT_KEY),
    caPem: overrides.caPem ?? decode(process.env.BOLAGSVERKET_CA),
    timeoutMs: overrides.timeoutMs ?? 30_000,
  }
}

interface HttpResponse {
  status: number
  body: string
}

function rawRequest(
  config: BolagsverketClientConfig,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  jsonBody?: unknown,
): Promise<HttpResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const parsed = new URL(url)
    const payload = jsonBody === undefined ? null : JSON.stringify(jsonBody)
    const options: RequestOptions = {
      method,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: config.timeoutMs ?? 30_000,
    }
    // mTLS for accept/prod (the test env is plain TLS behind a firewall).
    if (config.environment !== 'test') {
      if (!config.clientCertPem || !config.clientKeyPem) {
        rejectPromise(
          new BolagsverketApiError(
            'Organisationscertifikat saknas — BOLAGSVERKET_CLIENT_CERT/BOLAGSVERKET_CLIENT_KEY (eller motsvarande extensionsinställningar) krävs för acceptans- och produktionsmiljön.',
            0,
            '',
          ),
        )
        return
      }
      options.cert = config.clientCertPem
      options.key = config.clientKeyPem
      if (config.caPem) options.ca = config.caPem
    }
    const req = httpsRequest(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', (err) => {
      rejectPromise(
        new BolagsverketApiError(
          `Kunde inte nå Bolagsverket (${err.message}). Kontrollera brandväggsöppning och certifikat.`,
          0,
          '',
        ),
      )
    })
    if (payload) req.write(payload)
    req.end()
  })
}

function mapError(status: number, body: string): BolagsverketApiError {
  // Error bodies carry "NNNN=text" or {"felkod":"NNNN", ...}-style content;
  // map known codes to curated Swedish messages, fall back to the raw body.
  const codeMatch = body.match(/\b([4579]\d{3})\b/)
  const known = codeMatch ? BOLAGSVERKET_ERROR_MESSAGES[codeMatch[1]] : null
  const fallback =
    status === 404
      ? 'Ingen träff hos Bolagsverket (404).'
      : status === 503 || status === 504
        ? 'Bolagsverkets tjänst är tillfälligt otillgänglig — försök igen om en stund.'
        : `Bolagsverket svarade med fel (HTTP ${status}).`
  return new BolagsverketApiError(known ?? fallback, status, body.slice(0, 2_000))
}

async function requestJson<T>(
  config: BolagsverketClientConfig,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  jsonBody?: unknown,
): Promise<T> {
  const res = await rawRequest(config, method, url, jsonBody)
  if (res.status < 200 || res.status >= 300) throw mapError(res.status, res.body)
  if (res.body.trim().length === 0) return undefined as T
  try {
    return JSON.parse(res.body) as T
  } catch {
    throw new BolagsverketApiError('Oväntat svar från Bolagsverket (inte JSON).', res.status, res.body.slice(0, 500))
  }
}

export class BolagsverketClient {
  constructor(private readonly config: BolagsverketClientConfig) {}

  get environment(): BolagsverketEnvironment {
    return this.config.environment
  }

  private url(service: string, path: string): string {
    const { base, prefix } = HOSTS[this.config.environment]
    return `${base}${prefix}/${service}${path}`
  }

  // ---- informationstjänster (GUIDE §5.2) ----------------------------------

  getGrunduppgifter(orgnr: string): Promise<GrunduppgifterSvar> {
    return requestJson(this.config, 'GET', this.url('hamta-arsredovisningsinformation/v1.4', `/grunduppgifter/${encodeURIComponent(orgnr)}`))
  }

  getArendestatus(orgnr: string): Promise<ArendestatusSvar> {
    return requestJson(this.config, 'GET', this.url('hamta-arsredovisningsinformation/v1.4', `/arendestatus/${encodeURIComponent(orgnr)}`))
  }

  /** Token for skapa-kontrollsumma (information service, v1.1). */
  createChecksumToken(pnr: string, orgnr: string): Promise<InlamningTokenSvar> {
    return requestJson(this.config, 'POST', this.url('hamta-arsredovisningsinformation/v1.1', '/skapa-inlamningtoken/'), { pnr, orgnr })
  }

  createChecksum(token: string, fileBase64: string): Promise<KontrollsummaSvar> {
    return requestJson(this.config, 'POST', this.url('hamta-arsredovisningsinformation/v1.1', `/skapa-kontrollsumma/${encodeURIComponent(token)}`), { fil: fileBase64 })
  }

  // ---- inlämning (GUIDE §5.3) ----------------------------------------------

  createInlamningToken(pnr: string, orgnr: string): Promise<InlamningTokenSvar> {
    return requestJson(this.config, 'POST', this.url('lamna-in-arsredovisning/v2.1', '/skapa-inlamningtoken/'), { pnr, orgnr })
  }

  kontrollera(token: string, fileBase64: string, typ: HandlingTyp): Promise<KontrolleraSvar> {
    return requestJson(this.config, 'POST', this.url('lamna-in-arsredovisning/v2.1', `/kontrollera/${encodeURIComponent(token)}`), {
      handling: { fil: fileBase64, typ },
    })
  }

  lamnaIn(
    token: string,
    body: {
      undertecknare: string
      epostadresser: string[]
      kvittensepostadresser?: string[]
      notifieringEpostadresser?: string[]
      fileBase64: string
      typ: HandlingTyp
    },
  ): Promise<InlamningSvar> {
    return requestJson(this.config, 'POST', this.url('lamna-in-arsredovisning/v2.1', `/inlamning/${encodeURIComponent(token)}`), {
      undertecknare: body.undertecknare,
      epostadresser: body.epostadresser,
      ...(body.kvittensepostadresser?.length ? { kvittensepostadresser: body.kvittensepostadresser } : {}),
      ...(body.notifieringEpostadresser?.length ? { notifieringEpostadresser: body.notifieringEpostadresser } : {}),
      handling: { fil: body.fileBase64, typ: body.typ },
    })
  }

  // ---- händelser (GUIDE §5.4) ----------------------------------------------

  /** Idempotent: existing (url, orgnr) pair gets its TTL extended 6 months. */
  async createSubscription(url: string, orgnr: string, auth: string): Promise<void> {
    await requestJson(this.config, 'POST', this.url('hantera-arsredovisningsprenumerationer/v2.0', '/handelseprenumeration/'), {
      prenumerationer: [{ url, orgnr, auth }],
    })
  }

  async deleteSubscription(url: string, orgnr: string): Promise<void> {
    await requestJson(this.config, 'DELETE', this.url('hantera-arsredovisningsprenumerationer/v2.0', '/handelseprenumeration/'), { url, orgnr })
  }

  /** Polling fallback for missed webhooks (events kept ~1 year). */
  hamtaHandelser(body: {
    url: string
    orgnr: string[]
    fromtidpunkt?: string
    tomtidpunkt?: string
  }): Promise<HamtaHandelserSvar> {
    return requestJson(this.config, 'POST', this.url('hamta-arsredovisningshandelser/v2.0', '/handelser/'), body)
  }
}
