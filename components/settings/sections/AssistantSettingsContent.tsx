'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { AgentMemoryPanel } from '@/components/settings/AgentMemoryPanel'
import { AgentSkillsPanel } from '@/components/settings/AgentSkillsPanel'
import { AgentKnowledgePanel } from '@/components/agent-knowledge/AgentKnowledgePanel'

// "Assistenten": the ledger profile the agent reads before booking (Kunskap =
// "Vad din agent vet", opens on the konteringskarta and is the default view),
// what the assistant remembers about this company (Minne, editable), and the
// domain knowledge it ships with (Kompetens, read-only). Tabs keep all three
// one click away instead of stacked.
type View = 'knowledge' | 'memory' | 'skills'

const VIEW_ROUTE: Record<View, string> = {
  knowledge: '/settings/assistant',
  memory: '/settings/assistant?view=memory',
  skills: '/settings/assistant?view=skills',
}

export function AssistantSettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const raw = searchParams.get('view')
  const view: View = raw === 'skills' ? 'skills' : raw === 'memory' ? 'memory' : 'knowledge'

  function setView(next: string) {
    // 'knowledge' is the default: keep its URL clean (no query string).
    router.replace(VIEW_ROUTE[next as View] ?? VIEW_ROUTE.knowledge, { scroll: false })
  }

  return (
    <Tabs value={view} onValueChange={setView} className="space-y-6">
      <TabsList>
        <TabsTrigger value="knowledge">Kunskap</TabsTrigger>
        <TabsTrigger value="memory">Minne</TabsTrigger>
        <TabsTrigger value="skills">Kompetens</TabsTrigger>
      </TabsList>

      {/* Radix unmounts the inactive panel, so each panel's data is fetched
          lazily the first time its tab is opened. */}
      <TabsContent value="knowledge">
        <AgentKnowledgePanel />
      </TabsContent>
      <TabsContent value="memory">
        <AgentMemoryPanel />
      </TabsContent>
      <TabsContent value="skills">
        <AgentSkillsPanel />
      </TabsContent>
    </Tabs>
  )
}
