'use client'

import type { ExtensionDefinition } from '@/lib/extensions/types'
import { resolveIcon } from '@/lib/extensions/icon-resolver'

export default function ExtensionWorkspaceShell({
  definition,
  children,
}: {
  definition: ExtensionDefinition
  children: React.ReactNode
}) {
  const Icon = resolveIcon(definition.icon)

  return (
    <div className="max-w-5xl mx-auto px-5 py-8 md:px-8 md:py-10">
      {/* Header */}
      <div className="flex items-start gap-4 mb-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 flex-shrink-0">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{definition.name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{definition.description}</p>
        </div>
      </div>

      {/* Extension content */}
      {children}
    </div>
  )
}
