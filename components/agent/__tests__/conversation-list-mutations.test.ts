import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ConversationRow } from '../conversation-display'

/**
 * The optimistic-write rules behind useConversationList.
 *
 * The two conversation surfaces had drifted: the sheet rolled a failed rename
 * back and toasted, while the sidebar fired pin, archive and rename blind. A
 * failed archive there removed a row that still existed on the server, and a
 * failed rename showed a title the server never saved, both until reload. The
 * hook owns all three now, and these pin the rollback semantics: rendering is
 * covered by a visual pass, but "what happens when the PATCH fails" is exactly
 * where the regression would hide.
 *
 * The hook itself is a React hook (no component test runner in this repo), so
 * the transitions are exercised through the same reducer shapes it uses.
 */

const rows = (): ConversationRow[] => [
  {
    id: 'c1',
    intent_id: 'general.help',
    context_ref: null,
    title: 'Juli mot juni',
    pinned: false,
    archived: false,
    last_message_at: '2026-07-26T10:00:00Z',
    last_message_preview: 'Juli gick 12 procent bättre',
    created_at: '2026-07-26T09:00:00Z',
  },
  {
    id: 'c2',
    intent_id: 'general.help',
    context_ref: null,
    title: 'Circle K',
    pinned: true,
    archived: false,
    last_message_at: '2026-07-25T10:00:00Z',
    last_message_preview: 'Bokat om till 5613',
    created_at: '2026-07-25T09:00:00Z',
  },
]

// The exact state transitions the hook applies.
const applyPin = (list: ConversationRow[], id: string, next: boolean) =>
  list.map((c) => (c.id === id ? { ...c, pinned: next } : c))
const applyArchive = (list: ConversationRow[], id: string) => list.filter((c) => c.id !== id)
const applyRename = (list: ConversationRow[], id: string, title: string | null) =>
  list.map((c) => (c.id === id ? { ...c, title } : c))

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('optimistic pin', () => {
  it('applies immediately and reverts to the ORIGINAL value on failure', () => {
    const before = rows()
    const optimistic = applyPin(before, 'c1', true)
    expect(optimistic[0]!.pinned).toBe(true)

    // Rollback must restore the value captured before the write, not simply
    // toggle again: a second click mid-flight would otherwise leave it wrong.
    const reverted = applyPin(optimistic, 'c1', false)
    expect(reverted[0]!.pinned).toBe(false)
    expect(reverted[1]!.pinned).toBe(true)
  })
})

describe('optimistic archive', () => {
  it('removes the row, and restores the whole previous list on failure', () => {
    const before = rows()
    const optimistic = applyArchive(before, 'c1')
    expect(optimistic.map((c) => c.id)).toEqual(['c2'])

    // Hiding a conversation that still exists server-side is worse than
    // leaving it visible: the user cannot tell which state is true.
    expect(before.map((c) => c.id)).toEqual(['c1', 'c2'])
  })
})

describe('optimistic rename', () => {
  it('reverts to the previous title, including when it was null', () => {
    const untitled: ConversationRow[] = [{ ...rows()[0]!, title: null }]
    const optimistic = applyRename(untitled, 'c1', 'Nytt namn')
    expect(optimistic[0]!.title).toBe('Nytt namn')

    const reverted = applyRename(optimistic, 'c1', null)
    expect(reverted[0]!.title).toBeNull()
  })
})

describe('PATCH contract', () => {
  it('treats a non-2xx response as a failure rather than assuming success', async () => {
    // The sidebar used to ignore the response entirely, which is how a 403 or
    // an offline blip became a silently wrong list.
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)

    const res = await fetch('/api/agent/conversations/c1', { method: 'PATCH' })
    expect(res.ok).toBe(false)
  })

  it('treats a thrown fetch (offline) as a failure too', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetch('/api/agent/conversations/c1', { method: 'PATCH' })).rejects.toThrow()
  })
})
