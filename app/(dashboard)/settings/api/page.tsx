'use client'

import { ApiKeysPanel } from '@/components/settings/ApiKeysPanel'
import { AgentAutoCommitSettings } from '@/components/settings/AgentAutoCommitSettings'

export default function ApiSettingsPage() {
  return (
    <div className="space-y-8">
      <AgentAutoCommitSettings />
      <ApiKeysPanel />
    </div>
  )
}
