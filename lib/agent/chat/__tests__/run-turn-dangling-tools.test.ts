import { describe, it, expect } from 'vitest'
import { repairDanglingToolUse } from '../run-turn'

/**
 * A turn persists the assistant message carrying tool_use blocks BEFORE the
 * tools run, and their tool_result blocks only after the whole batch finishes.
 * If the process dies in between (client disconnect terminating the function,
 * a deploy, a tool outliving the request), the stored history ends on an
 * unanswered tool_use. The Messages API rejects that shape, so every later turn
 * 400s, and agent_messages is append-only (BFL audit trail) so nothing can
 * repair the row: the conversation is bricked permanently.
 *
 * repairDanglingToolUse patches the shape on READ only, leaving the stored
 * trail untouched.
 */

const textBlock = (text: string) => [{ type: 'text', text }]

describe('repairDanglingToolUse', () => {
  it('leaves a well-formed conversation untouched', () => {
    const messages = [
      { role: 'user' as const, content: textBlock('Boka om Circle K') },
      {
        role: 'assistant' as const,
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'gnubok_query_journal', input: {} },
        ],
      },
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'A-207' }],
      },
      { role: 'assistant' as const, content: textBlock('Klart att godkänna.') },
    ]

    expect(repairDanglingToolUse(messages)).toEqual(messages)
  })

  it('synthesizes an error tool_result for an unanswered tool_use', () => {
    const messages = [
      { role: 'user' as const, content: textBlock('Gör klart juli') },
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 'tu_dead', name: 'gnubok_list_transactions', input: {} }],
      },
    ]

    const repaired = repairDanglingToolUse(messages)

    expect(repaired).toHaveLength(3)
    expect(repaired[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_dead',
          content: expect.stringContaining('Avbröts'),
          is_error: true,
        },
      ],
    })
  })

  it('repairs only the unanswered call in a mixed batch', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [
          { type: 'tool_use', id: 'tu_ok', name: 'a', input: {} },
          { type: 'tool_use', id: 'tu_dead', name: 'b', input: {} },
        ],
      },
      {
        role: 'user' as const,
        content: [{ type: 'tool_result', tool_use_id: 'tu_ok', content: 'fine' }],
      },
    ]

    const repaired = repairDanglingToolUse(messages)
    const synthesized = repaired.filter(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b: { is_error?: boolean }) => b.is_error === true),
    )

    expect(synthesized).toHaveLength(1)
    expect(synthesized[0]!.content).toHaveLength(1)
    expect(synthesized[0]!.content[0].tool_use_id).toBe('tu_dead')
  })

  it('inserts the stub immediately after the assistant turn that opened it', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', id: 'tu_dead', name: 'a', input: {} }],
      },
      { role: 'user' as const, content: textBlock('är du kvar?') },
    ]

    const repaired = repairDanglingToolUse(messages)

    // The stub must sit between the tool_use and the next user turn, otherwise
    // the API still sees an unanswered tool_use followed by a user message.
    expect(repaired.map((m) => m.role)).toEqual(['assistant', 'user', 'user'])
    expect(repaired[1]!.content[0].tool_use_id).toBe('tu_dead')
    expect(repaired[2]!.content[0].text).toBe('är du kvar?')
  })

  it('tolerates string and non-array content without throwing', () => {
    const messages = [
      { role: 'user' as const, content: 'plain string content' as unknown as [] },
      { role: 'assistant' as const, content: null as unknown as [] },
    ]

    expect(() => repairDanglingToolUse(messages)).not.toThrow()
    expect(repairDanglingToolUse(messages)).toHaveLength(2)
  })
})
