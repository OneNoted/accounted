import { describe, it, expect } from 'vitest'
import { isInternalHref } from '../markdown-links'
import { announceableAnswer } from '../AgentChat'
import { intentLabel } from '../conversation-display'

describe('isInternalHref', () => {
  it('routes app paths client-side', () => {
    expect(isInternalHref('/invoices/abc-123')).toBe(true)
    expect(isInternalHref('/bookkeeping/year-end?step=2')).toBe(true)
    expect(isInternalHref('/kpi#marginal')).toBe(true)
  })

  it('does not treat a protocol-relative url as internal', () => {
    // The href comes out of a model that reads customer documents. "//host"
    // starts with a slash but leaves the site, and handing it to the router as
    // an app path is the one failure mode worth engineering against.
    expect(isInternalHref('//evil.example/login')).toBe(false)
    expect(isInternalHref('/\\evil.example')).toBe(false)
  })

  it('leaves absolute and non-http schemes external', () => {
    expect(isInternalHref('https://skatteverket.se')).toBe(false)
    expect(isInternalHref('http://example.com')).toBe(false)
    expect(isInternalHref('mailto:a@b.se')).toBe(false)
    expect(isInternalHref('javascript:alert(1)')).toBe(false)
    expect(isInternalHref('')).toBe(false)
  })
})

describe('announceableAnswer', () => {
  const msg = (role: 'user' | 'assistant', text: string) =>
    ({ role, text }) as Parameters<typeof announceableAnswer>[0][number]

  it('announces the finished answer, not the question', () => {
    expect(
      announceableAnswer([msg('user', 'Hur gick juli?'), msg('assistant', 'Juli gick 12 % bättre.')]),
    ).toBe('Juli gick 12 % bättre.')
  })

  it('reads the LAST assistant turn when the thread has several', () => {
    expect(
      announceableAnswer([
        msg('assistant', 'Första svaret.'),
        msg('user', 'Och augusti?'),
        msg('assistant', 'Andra svaret.'),
      ]),
    ).toBe('Andra svaret.')
  })

  it('caps a long answer and says where the rest is', () => {
    // A screen reader reads a live region straight through: a full bokslut
    // explanation announced in one uninterruptible burst is worse than not
    // announcing at all.
    const long = 'a'.repeat(1000)
    const out = announceableAnswer([msg('assistant', long)])
    expect(out.length).toBeLessThan(500)
    expect(out).toContain('Svaret fortsätter i meddelandet')
  })

  it('still says something when the turn produced no text', () => {
    // A tool-only turn, or one stopped before any text arrived: silence would
    // be indistinguishable from the request never having been sent.
    expect(announceableAnswer([msg('user', 'Boka detta')])).toBe('Assistenten är klar.')
    expect(announceableAnswer([msg('assistant', '   ')])).toBe('Assistenten är klar.')
    expect(announceableAnswer([])).toBe('Assistenten är klar.')
  })
})

describe('intentLabel', () => {
  it('never shows the raw intent id', () => {
    // It used to return the id itself, so an unmapped intent put
    // "bokslut.step" in front of the user as the name of their conversation.
    expect(intentLabel('some.unmapped.intent')).toBe('Fråga din assistent')
    expect(intentLabel('some.unmapped.intent', 'Anna')).toBe('Fråga Anna')
  })

  it('gives the panel and the history list the SAME name for a thread', () => {
    // The two maps had drifted: the panel titled a bokslut thread "Fråga Anna"
    // while the history list called it "Hjälp med bokslut".
    expect(intentLabel('bokslut.step')).toBe('Hjälp med bokslut')
    expect(intentLabel('bokslut.step', 'Anna')).toBe('Hjälp med bokslut')
    expect(intentLabel('kpi.explain', 'Anna')).toBe('Förklara nyckeltal')
  })

  it('personalises general help and falls back without a name', () => {
    expect(intentLabel('general.help', 'Anna')).toBe('Fråga Anna')
    expect(intentLabel('general.help')).toBe('Fråga din assistent')
    expect(intentLabel('general.help', '   ')).toBe('Fråga din assistent')
  })

  it('keeps momsdeklaration spelled correctly through the soft hyphen', () => {
    // The label carries a U+00AD so it can break across the narrow panel.
    // Stripping it must leave a real word.
    expect(intentLabel('vat.review').replace(/­/g, '')).toBe('Granska momsdeklaration')
  })
})
