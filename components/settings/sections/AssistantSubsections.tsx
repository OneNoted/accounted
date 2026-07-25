'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { AgentMemoryPanel } from '@/components/settings/AgentMemoryPanel'
import { AgentSkillsPanel } from '@/components/settings/AgentSkillsPanel'
import { AgentKnowledgePanel } from '@/components/agent-knowledge/AgentKnowledgePanel'

/**
 * Assistant settings decomposed into standalone subsections so the settings
 * sheet can render them as accordion panels (Dragspelet) while the legacy
 * full-section component composes the same pieces inside its tabs. One
 * implementation, two layouts: the sheet and the section view can never drift.
 */

/** Kunskap: the ledger profile the agent reads before booking ("Vad din agent
 *  vet"), opening on the konteringskarta. */
export function AssistantKnowledgeSettings() {
  return <AgentKnowledgePanel />
}

/** Minne: what the assistant remembers about this company (editable). */
export function AssistantMemorySettings() {
  return <AgentMemoryPanel />
}

/** Kompetens: the domain knowledge the assistant ships with (read-only). */
export function AssistantSkillsSettings() {
  return <AgentSkillsPanel />
}

// Per-user toggle for the floating assistant button bottom-right. The value
// lives on user_preferences (server-rendered into the dashboard layout), so
// a successful save triggers router.refresh() to make the button react
// immediately instead of on next navigation.
export function AssistantFabVisibilitySettings() {
  const t = useTranslations('settings_assistant')
  const router = useRouter()
  // null = not yet loaded (switch disabled meanwhile)
  const [hideFab, setHideFab] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/user/preferences')
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setHideFab(Boolean(body?.data?.hide_assistant_fab))
      })
      .catch(() => {
        if (!cancelled) setHideFab(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleToggle(showFab: boolean) {
    const nextHide = !showFab
    const previous = hideFab
    setHideFab(nextHide)
    setSaving(true)
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hide_assistant_fab: nextHide }),
      })
      if (!res.ok) throw new Error('save failed')
      router.refresh()
    } catch {
      setHideFab(previous)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6 flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('fab_title')}</p>
          <p className="text-sm text-muted-foreground">{t('fab_description')}</p>
        </div>
        <Switch
          checked={hideFab === null ? true : !hideFab}
          onCheckedChange={handleToggle}
          disabled={hideFab === null || saving}
          aria-label={t('fab_title')}
        />
      </CardContent>
    </Card>
  )
}
