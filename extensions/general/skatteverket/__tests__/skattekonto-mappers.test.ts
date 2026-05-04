import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeDedupKey } from '../lib/skattekonto-sync'
import type {
  SkatteverketSaldoResponse,
  SkatteverketTransaktionerResponse,
} from '../types'

// Spec dir has parens in the name, so import attribute would fail in some
// bundlers. Read the JSON at test time with fs instead.
const examplesDir = join(
  process.cwd(),
  'dev_docs',
  'skattekonto(2.1.0)',
  'examples',
)
const saldoResponseExample = JSON.parse(
  readFileSync(join(examplesDir, 'saldoResponse.json'), 'utf8'),
)
const transaktionerResponseExample = JSON.parse(
  readFileSync(join(examplesDir, 'transaktionerResponse.json'), 'utf8'),
)

describe('skattekonto example payloads', () => {
  it('saldoResponse.json fits SkatteverketSaldoResponse', () => {
    const saldo = saldoResponseExample as SkatteverketSaldoResponse
    expect(saldo.saldoSkatteverket).toBe(-14487)
    expect(saldo.saldoKronofogden).toBe(-145409)
    expect(saldo.ocrNummer).toBe('1948040320946')
    expect(saldo.nastaAvstamningsdatum).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Array.isArray(saldo.informationstext)).toBe(true)
  })

  it('transaktionerResponse.json fits SkatteverketTransaktionerResponse', () => {
    const tx = transaktionerResponseExample as SkatteverketTransaktionerResponse
    expect(Array.isArray(tx.tidigareTransaktioner)).toBe(true)
    expect(Array.isArray(tx.kommandeTransaktioner)).toBe(true)

    const booked = tx.tidigareTransaktioner[0]
    expect(typeof booked.transaktionsidentitet).toBe('number')
    expect(booked.transaktionsdatum).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(typeof booked.beloppSkatteverket).toBe('number')
  })
})

describe('computeDedupKey', () => {
  it('uses transaktionsidentitet when present', () => {
    const key = computeDedupKey({
      transaktionsidentitet: 746876987,
      transaktionsdatum: '2019-04-16',
      beloppSkatteverket: 1292,
      transaktionstext: 'Inbetalning bokförd 190412',
    })
    expect(key).toBe('id:746876987')
  })

  it('falls back to a content hash when transaktionsidentitet is missing', () => {
    const key = computeDedupKey({
      transaktionsidentitet: null,
      transaktionsdatum: '2019-05-13',
      beloppSkatteverket: -1292,
      transaktionstext: 'Debiterad preliminärskatt',
    })
    expect(key).toMatch(/^h:[0-9a-f]{64}$/)
  })

  it('produces stable keys for the same content', () => {
    const tx = {
      transaktionsidentitet: null,
      transaktionsdatum: '2019-05-13',
      beloppSkatteverket: -1292,
      transaktionstext: 'Debiterad preliminärskatt',
    }
    expect(computeDedupKey(tx)).toBe(computeDedupKey(tx))
  })

  it('produces different keys for different content', () => {
    const a = computeDedupKey({
      transaktionsidentitet: null,
      transaktionsdatum: '2019-05-13',
      beloppSkatteverket: -1292,
      transaktionstext: 'A',
    })
    const b = computeDedupKey({
      transaktionsidentitet: null,
      transaktionsdatum: '2019-05-13',
      beloppSkatteverket: -1292,
      transaktionstext: 'B',
    })
    expect(a).not.toBe(b)
  })

  it('treats undefined transaktionsidentitet the same as null', () => {
    const a = computeDedupKey({
      transaktionsdatum: '2019-05-13',
      beloppSkatteverket: -1292,
      transaktionstext: 'X',
    })
    const b = computeDedupKey({
      transaktionsidentitet: null,
      transaktionsdatum: '2019-05-13',
      beloppSkatteverket: -1292,
      transaktionstext: 'X',
    })
    expect(a).toBe(b)
  })
})
