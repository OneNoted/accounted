import { describe, it, expect } from 'vitest'
import { getErrorMessage } from '../get-error-message'
import {
  AccountsNotInChartError,
  BookkeepingDatabaseError,
  CannotEditNonDraftError,
  CannotReverseStornoError,
  JournalEntryNotBalancedError,
} from '@/lib/bookkeeping/errors'

describe('getErrorMessage: typed bookkeeping error codes', () => {
  it('ACCOUNTS_NOT_IN_CHART → lists accounts to activate', () => {
    const msg = getErrorMessage({
      error: { code: 'ACCOUNTS_NOT_IN_CHART', message: '...', account_numbers: ['1930', '2641'] },
    })
    expect(msg).toBe('Följande konton behöver aktiveras: 1930, 2641')
  })

  it('JOURNAL_ENTRY_NOT_BALANCED with details → rich amount message', () => {
    const msg = getErrorMessage({
      error: {
        code: 'JOURNAL_ENTRY_NOT_BALANCED',
        message: 'Journal entry is not balanced: debits (100) != credits (80)',
        details: { totalDebit: 100, totalCredit: 80, kind: 'draft' },
      },
    })
    expect(msg).toContain('balanserar inte')
    expect(msg).toContain('debet')
    expect(msg).toContain('kredit')
    expect(msg).toMatch(/100/)
    expect(msg).toMatch(/80/)
  })

  it('JOURNAL_ENTRY_NOT_BALANCED without details → fallback Swedish message', () => {
    const msg = getErrorMessage({
      error: { code: 'JOURNAL_ENTRY_NOT_BALANCED', message: '...' },
    })
    expect(msg).toBe('Verifikationen balanserar inte. Kontrollera att debet och kredit är lika stora.')
  })

  it('FISCAL_PERIOD_NOT_FOUND → Swedish message', () => {
    const msg = getErrorMessage({ error: { code: 'FISCAL_PERIOD_NOT_FOUND', message: '...' } })
    expect(msg).toBe('Räkenskapsperioden kunde inte hittas.')
  })

  it('ENTRY_DATE_OUTSIDE_FISCAL_PERIOD → Swedish message', () => {
    const msg = getErrorMessage({ error: { code: 'ENTRY_DATE_OUTSIDE_FISCAL_PERIOD', message: '...' } })
    expect(msg).toBe('Datumet ligger utanför det valda räkenskapsåret.')
  })

  it('JOURNAL_ENTRY_NOT_FOUND → Swedish message', () => {
    const msg = getErrorMessage({ error: { code: 'JOURNAL_ENTRY_NOT_FOUND', message: '...' } })
    expect(msg).toBe('Verifikationen kunde inte hittas.')
  })

  it('CANNOT_REVERSE_NON_POSTED → Swedish message', () => {
    const msg = getErrorMessage({ error: { code: 'CANNOT_REVERSE_NON_POSTED', message: '...' } })
    expect(msg).toBe('Endast bokförda verifikationer kan stornas.')
  })

  it('CANNOT_CORRECT_NON_POSTED → Swedish message', () => {
    const msg = getErrorMessage({ error: { code: 'CANNOT_CORRECT_NON_POSTED', message: '...' } })
    expect(msg).toBe('Endast bokförda verifikationer kan rättas.')
  })

  it('ENTRY_ALREADY_REVERSED → Swedish concurrent-conflict message', () => {
    const msg = getErrorMessage({ error: { code: 'ENTRY_ALREADY_REVERSED', message: '...' } })
    expect(msg).toContain('redan stornats')
    expect(msg).toContain('Ladda om sidan')
  })

  it('CURRENCY_REVALUATION_ALREADY_EXISTS → Swedish message', () => {
    const msg = getErrorMessage({ error: { code: 'CURRENCY_REVALUATION_ALREADY_EXISTS', message: '...' } })
    expect(msg).toBe('En valutaomvärdering finns redan för denna period.')
  })

  it('INVALID_MAPPING_RESULT → Swedish message', () => {
    const msg = getErrorMessage({ error: { code: 'INVALID_MAPPING_RESULT', message: '...' } })
    expect(msg).toBe('Kontering saknas för transaktionen. Kontrollera bokföringsreglerna.')
  })

  it('BOOKKEEPING_DATABASE_ERROR → generic "kunde inte sparas" when no pattern matches', () => {
    const msg = getErrorMessage({
      error: {
        code: 'BOOKKEEPING_DATABASE_ERROR',
        message: 'Database operation "commit_entry" failed: some random constraint',
      },
    })
    expect(msg).toBe('Verifikationen kunde inte sparas. Försök igen.')
  })

  it('BOOKKEEPING_DATABASE_ERROR falls through to regex pattern for period lock', () => {
    // Period-lock trigger errors come through as DB errors: message should still
    // match the locked-period pattern and produce the specific Swedish message.
    const msg = getErrorMessage({
      error: {
        code: 'BOOKKEEPING_DATABASE_ERROR',
        message: 'Cannot create entry in locked/closed fiscal period',
      },
    })
    expect(msg).toBe('Perioden är låst. Verifikationen kan inte skapas i en stängd eller låst period.')
  })
})

describe('getErrorMessage: typed bookkeeping Error instances (issue #337)', () => {
  it('JournalEntryNotBalancedError instance → rich Swedish amount message', () => {
    const msg = getErrorMessage(new JournalEntryNotBalancedError(100, 80), { context: 'transaction' })
    expect(msg).toContain('balanserar inte')
    expect(msg).toMatch(/100/)
    expect(msg).toMatch(/80/)
    expect(msg).not.toContain('Journal entry is not balanced')
  })

  it('BookkeepingDatabaseError instance → Swedish, never the raw constraint string', () => {
    const msg = getErrorMessage(
      new BookkeepingDatabaseError(
        'commit_entry',
        'new row for relation "journal_entries" violates check constraint "check_balanced"',
      ),
      { context: 'transaction' },
    )
    expect(msg).toBe('Verifikationen kunde inte sparas. Försök igen.')
    expect(msg).not.toContain('check constraint')
    expect(msg).not.toContain('Database operation')
  })

  it('BookkeepingDatabaseError instance wrapping a period-lock trigger → specific Swedish message', () => {
    const msg = getErrorMessage(
      new BookkeepingDatabaseError('commit_entry', 'Cannot create entry in locked/closed fiscal period'),
    )
    expect(msg).toBe('Perioden är låst. Verifikationen kan inte skapas i en stängd eller låst period.')
  })

  it('AccountsNotInChartError instance → Swedish account-activation message', () => {
    const msg = getErrorMessage(new AccountsNotInChartError(['1930']))
    expect(msg).toBe('Följande konton behöver aktiveras: 1930')
  })

  it('CannotReverseStornoError instance → registry Swedish message (no dynamic branch)', () => {
    const msg = getErrorMessage(new CannotReverseStornoError('storno'))
    expect(msg).toBe(
      'En stornering kan inte stornas. Om verifikationen makulerades av misstag, bokför den på nytt (kopiera originalet).',
    )
    expect(msg).not.toContain('Cannot reverse')
  })

  it('locale "en" on a typed instance → registry English message', () => {
    const msg = getErrorMessage(new CannotReverseStornoError('storno'), { locale: 'en' })
    expect(msg).toBe(
      'A storno entry cannot be reversed. If the entry was cancelled by mistake, re-book it (copy the original).',
    )
  })

  it('regression: plain-object bare envelope with a Swedish message passes through unchanged', () => {
    const msg = getErrorMessage({ code: 'SOME_CODE', message: 'Kunde inte hantera fakturan. Försök igen.' })
    expect(msg).toBe('Kunde inte hantera fakturan. Försök igen.')
  })
})

describe('getErrorMessage: unknown-code Error instances never leak raw text (#337 follow-up)', () => {
  it('CannotEditNonDraftError instance → registry Swedish message', () => {
    const msg = getErrorMessage(new CannotEditNonDraftError('posted'))
    expect(msg).toBe('Endast utkast kan redigeras. Bokförda verifikationer rättas med storno.')
    expect(msg).not.toContain('Only draft entries')
  })

  it('CANNOT_EDIT_NON_DRAFT envelope → registry Swedish message', () => {
    const msg = getErrorMessage({
      error: { code: 'CANNOT_EDIT_NON_DRAFT', message: 'Only draft entries can be edited' },
    })
    expect(msg).toBe('Endast utkast kan redigeras. Bokförda verifikationer rättas med storno.')
  })

  it('ECONNREFUSED Error → transient Swedish message, never the socket string', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    })
    const msg = getErrorMessage(err)
    expect(msg).toBe('Kunde inte nå en extern tjänst. Försök igen om en stund.')
    expect(msg).not.toContain('127.0.0.1')
  })

  it('ECONNREFUSED Error with locale "en" → registry English message', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    })
    const msg = getErrorMessage(err, { locale: 'en' })
    expect(msg).toBe(
      'An upstream network call failed. Retry the same request after a short backoff.'
    )
  })

  it('Error with an unregistered code and English message → context fallback, not raw', () => {
    const err = Object.assign(new Error('some upstream failure text'), {
      code: 'E_SOMETHING_WEIRD',
    })
    const msg = getErrorMessage(err, { context: 'transaction' })
    expect(msg).toBe('Kunde inte hantera transaktionen. Försök igen.')
    expect(msg).not.toContain('upstream failure')
  })

  it('Error wrapping a Postgres SQLSTATE → Postgres-map Swedish message', () => {
    const err = Object.assign(
      new Error('duplicate key value violates unique constraint "invoices_pkey"'),
      { code: '23505' },
    )
    const msg = getErrorMessage(err)
    expect(msg).toBe('En post med samma uppgifter finns redan.')
    expect(msg).not.toContain('duplicate key')
  })

  it('Error with an unregistered code but a Swedish message passes through', () => {
    const err = Object.assign(new Error('Kunde inte hantera fakturan. Försök igen.'), {
      code: 'EXT_CUSTOM_CODE',
    })
    expect(getErrorMessage(err)).toBe('Kunde inte hantera fakturan. Försök igen.')
  })
})

describe('getErrorMessage: English locale uses registry English (C9)', () => {
  it('returns the registry English message for a known structured code instead of Swedish', () => {
    const code = 'FISCAL_PERIOD_NOT_FOUND'
    const sv = getErrorMessage({ error: { code, message: '...' } })
    const en = getErrorMessage({ error: { code, message: '...' } }, { locale: 'en' })

    expect(sv).toMatch(/[åäö]/i) // default (Swedish) path is unchanged
    expect(en).not.toBe(sv) // English locale now differs
    expect(en).not.toMatch(/[åäö]/i) // …and is no longer Swedish prose
    expect(en.toLowerCase()).toContain('fiscal period')
  })

  it('leaves the Swedish (default-locale) message identical to before', () => {
    expect(getErrorMessage({ error: { code: 'CANNOT_REVERSE_NON_POSTED', message: '...' } })).toBe(
      'Endast bokförda verifikationer kan stornas.',
    )
  })
})

describe('getErrorMessage: accumulated validation details', () => {
  it('surfaces the specific per-item reasons instead of the generic 400 message', () => {
    const msg = getErrorMessage(
      {
        error: 'Valideringsfel: korrigera innan godkännande',
        details: ['Tomas Tysén: Bankuppgifter saknas (clearingnummer och/eller kontonummer)'],
        warnings: [],
      },
      { context: 'salary', statusCode: 400 },
    )
    expect(msg).toContain('Tomas Tysén')
    expect(msg).toContain('Bankuppgifter saknas')
    expect(msg).toContain('Valideringsfel')
    // Must NOT collapse to the generic HTTP-400 fallback.
    expect(msg).not.toBe('Förfrågan innehåller ogiltiga uppgifter.')
  })

  it('joins multiple items and caps the list with an overflow hint', () => {
    const details = Array.from({ length: 7 }, (_, i) => `Anställd ${i + 1}: Bankuppgifter saknas`)
    const msg = getErrorMessage({ error: 'Valideringsfel', details }, { statusCode: 400 })
    expect(msg).toContain('Anställd 1')
    expect(msg).toContain('Anställd 5')
    expect(msg).toContain('•')
    expect(msg).toContain('(+2 till)')
    expect(msg).not.toContain('Anställd 6')
  })

  it('ignores a non-string details array and falls through to the status fallback', () => {
    const msg = getErrorMessage({ error: 'oklart fel', details: [{ x: 1 }] }, { statusCode: 400 })
    expect(msg).toBe('Förfrågan innehåller ogiltiga uppgifter.')
  })
})

describe('getErrorMessage: payment-file route messages surface (issue #945)', () => {
  // These specific { error: '...' } strings previously collapsed to the generic
  // HTTP-400 message because isSwedishUserMessage did not recognize "krävs" /
  // "saknar", so the user learned nothing about why the betalfil failed.
  it('surfaces a "saknar bankkontouppgifter" message instead of the generic 400', () => {
    const msg = getErrorMessage(
      { error: '2 anställd(a) saknar bankkontouppgifter' },
      { context: 'salary', statusCode: 400 },
    )
    expect(msg).toBe('2 anställd(a) saknar bankkontouppgifter')
    expect(msg).not.toBe('Förfrågan innehåller ogiltiga uppgifter.')
  })

  it('surfaces a "... krävs ..." message instead of the generic 400', () => {
    const msg = getErrorMessage(
      { error: 'Momsregistreringsnummer krävs när företaget är momsregistrerat (ML 11 kap. 8§)' },
      { context: 'settings', statusCode: 400 },
    )
    expect(msg).toContain('krävs')
    expect(msg).not.toBe('Förfrågan innehåller ogiltiga uppgifter.')
  })

  it('surfaces the missing company bank-account message', () => {
    const msg = getErrorMessage(
      { error: 'Företagets bankkonto (clearingnummer och kontonummer) saknas i företagsinställningar. Fyll i det under Inställningar → Fakturering för att skapa betalfil.' },
      { context: 'salary', statusCode: 400 },
    )
    expect(msg).toContain('Företagets bankkonto')
    expect(msg).not.toBe('Förfrågan innehåller ogiltiga uppgifter.')
  })
})

describe('getErrorMessage: existing patterns still work', () => {
  it('regex match for "Entry date ... outside fiscal period" on plain string', () => {
    const msg = getErrorMessage('Entry date 2024-06-15 is outside fiscal period "FY 2025"')
    expect(msg).toBe('Datumet ligger utanför det valda räkenskapsåret.')
  })

  it('regex match for "locked/closed fiscal period" on plain string', () => {
    const msg = getErrorMessage('Cannot create entry in locked/closed fiscal period')
    expect(msg).toBe('Perioden är låst. Verifikationen kan inte skapas i en stängd eller låst period.')
  })

  it('Swedish message passes through unchanged', () => {
    const msg = getErrorMessage('Bokföringen är låst t.o.m. 2024-12-31.')
    expect(msg).toBe('Bokföringen är låst t.o.m. 2024-12-31.')
  })

  it('falls through to context fallback when no pattern matches', () => {
    const msg = getErrorMessage('Random English error', { context: 'transaction' })
    expect(msg).toBe('Kunde inte hantera transaktionen. Försök igen.')
  })

  it('falls through to HTTP status map', () => {
    const msg = getErrorMessage(null, { statusCode: 404 })
    expect(msg).toBe('Resursen kunde inte hittas.')
  })

  it('falls through to generic message', () => {
    const msg = getErrorMessage(null)
    expect(msg).toBe('Något gick fel. Försök igen.')
  })
})
