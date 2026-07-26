'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { type ConversationRow, groupConversations } from './conversation-display'

/**
 * Shared state and mutations for the agent conversation list.
 *
 * The two surfaces that show conversations (the full-page /chat sidebar and the
 * in-sheet resume list) had drifted apart in behaviour, not just in chrome: the
 * sheet rolled a failed rename back and toasted, while the sidebar fired pin,
 * archive and rename blind, with no res.ok check, no rollback and no message.
 * A failed archive there removed a conversation from the list while it still
 * existed on the server, and a failed rename displayed a title the server never
 * saved, both until the next reload.
 *
 * Owning the state and all three mutations here means the two surfaces cannot
 * diverge again, and the sheet gains pin/archive it never had. The chrome
 * stays with each surface: a 320px sidebar that collapses to a rail and a sheet
 * panel are legitimately different shapes.
 */
export interface ConversationListApi {
  conversations: ConversationRow[]
  setConversations: React.Dispatch<React.SetStateAction<ConversationRow[]>>
  query: string
  setQuery: (q: string) => void
  grouped: { bucket: ReturnType<typeof groupConversations>[number]['bucket']; rows: ConversationRow[] }[]
  togglePin: (id: string, current: boolean) => Promise<void>
  archive: (id: string) => Promise<boolean>
  rename: (id: string, title: string) => Promise<void>
  // Inline rename plumbing, shared so Esc-to-cancel behaves identically.
  editingId: string | null
  editValue: string
  setEditValue: (v: string) => void
  startEdit: (c: ConversationRow) => void
  cancelEdit: () => void
  commitEdit: (id: string) => Promise<void>
}

async function patchConversation(id: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/agent/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

export function useConversationList(initial: ConversationRow[]): ConversationListApi {
  const [conversations, setConversations] = useState<ConversationRow[]>(initial)
  const [query, setQuery] = useState('')
  const { toast } = useToast()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  // Set by Esc so the blur fired when the input unmounts doesn't save.
  const cancelRef = useRef(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        (c.title ?? '').toLowerCase().includes(q) ||
        (c.last_message_preview ?? '').toLowerCase().includes(q) ||
        (c.context_ref ?? '').toLowerCase().includes(q) ||
        c.intent_id.toLowerCase().includes(q),
    )
  }, [conversations, query])

  const grouped = useMemo(() => groupConversations(filtered), [filtered])

  const togglePin = useCallback(
    async (id: string, current: boolean) => {
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: !current } : c)))
      const ok = await patchConversation(id, { pinned: !current })
      if (ok) return
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, pinned: current } : c)))
      toast({ variant: 'destructive', title: 'Kunde inte ändra fästningen.' })
    },
    [toast],
  )

  /** Resolves true when the row is really archived, so callers can navigate. */
  const archive = useCallback(
    async (id: string) => {
      const previous = conversations
      setConversations((prev) => prev.filter((c) => c.id !== id))
      const ok = await patchConversation(id, { archived: true })
      if (ok) return true
      // Put it back: hiding a conversation that still exists is worse than
      // leaving it visible, because the user cannot tell which is true.
      setConversations(previous)
      toast({ variant: 'destructive', title: 'Kunde inte arkivera konversationen.' })
      return false
    },
    [conversations, toast],
  )

  const rename = useCallback(
    async (id: string, title: string) => {
      const current = conversations.find((c) => c.id === id)
      const previousTitle = current?.title ?? null
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
      const ok = await patchConversation(id, { title })
      if (ok) return
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: previousTitle } : c)),
      )
      toast({ variant: 'destructive', title: 'Kunde inte byta namn på konversationen.' })
    },
    [conversations, toast],
  )

  const startEdit = useCallback((c: ConversationRow) => {
    setEditingId(c.id)
    setEditValue(c.title ?? '')
    cancelRef.current = false
  }, [])

  const cancelEdit = useCallback(() => {
    cancelRef.current = true
    setEditingId(null)
  }, [])

  const commitEdit = useCallback(
    async (id: string) => {
      if (cancelRef.current) {
        cancelRef.current = false
        return
      }
      setEditingId(null)
      const title = editValue.trim()
      const current = conversations.find((c) => c.id === id)
      if (!title || title === current?.title) return
      await rename(id, title)
    },
    [conversations, editValue, rename],
  )

  return {
    conversations,
    setConversations,
    query,
    setQuery,
    grouped,
    togglePin,
    archive,
    rename,
    editingId,
    editValue,
    setEditValue,
    startEdit,
    cancelEdit,
    commitEdit,
  }
}
