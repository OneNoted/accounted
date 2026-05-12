import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeDefaultCursor,
  encodeDefaultCursor,
  nextCursorFromPage,
  parsePaginationParams,
} from '../pagination'

describe('parsePaginationParams', () => {
  it('returns defaults when no params present', () => {
    const url = new URL('https://example.com/v1/x')
    expect(parsePaginationParams(url)).toEqual({ limit: DEFAULT_LIMIT, cursor: null })
  })

  it('parses limit and clamps to MAX_LIMIT', () => {
    const url = new URL('https://example.com/v1/x?limit=999')
    expect(parsePaginationParams(url).limit).toBe(MAX_LIMIT)
  })

  it('floors limit to default for non-numeric input', () => {
    const url = new URL('https://example.com/v1/x?limit=abc')
    expect(parsePaginationParams(url).limit).toBe(DEFAULT_LIMIT)
  })

  it('treats limit=0 as invalid → DEFAULT_LIMIT', () => {
    const url = new URL('https://example.com/v1/x?limit=0')
    expect(parsePaginationParams(url).limit).toBe(DEFAULT_LIMIT)
  })

  it('returns the cursor verbatim when supplied', () => {
    const url = new URL('https://example.com/v1/x?cursor=abc123')
    expect(parsePaginationParams(url).cursor).toBe('abc123')
  })
})

describe('default cursor encode/decode', () => {
  it('round-trips a row', () => {
    const row = { id: '8fd5b1f4-1234-1234-1234-1234567890ab', created_at: '2026-05-12T16:00:00Z' }
    const cur = encodeDefaultCursor(row)
    expect(cur).not.toBeNull()
    expect(decodeDefaultCursor(cur)).toEqual({ ts: row.created_at, id: row.id })
  })

  it('returns null for null input', () => {
    expect(encodeDefaultCursor(null)).toBeNull()
  })

  it('returns null when decoding a malformed cursor', () => {
    expect(decodeDefaultCursor('not-base64-or-json')).toBeNull()
    expect(decodeDefaultCursor('')).toBeNull()
    expect(decodeDefaultCursor(null)).toBeNull()
  })

  it('returns null when decoding a JSON object missing fields', () => {
    const cursor = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url')
    expect(decodeDefaultCursor(cursor)).toBeNull()
  })
})

describe('nextCursorFromPage', () => {
  const row = (id: string, ts: string) => ({ id, created_at: ts })

  it('returns null when the page is not full', () => {
    const rows = [row('a', '2026-01-01'), row('b', '2026-01-02')]
    expect(nextCursorFromPage(rows, 5)).toBeNull()
  })

  it('returns a cursor when there are more rows than the limit', () => {
    const rows = [row('a', '2026-01-01'), row('b', '2026-01-02'), row('c', '2026-01-03')]
    const cursor = nextCursorFromPage(rows, 2)
    expect(cursor).not.toBeNull()
    expect(decodeDefaultCursor(cursor)).toEqual({ ts: '2026-01-03', id: 'c' })
  })
})
