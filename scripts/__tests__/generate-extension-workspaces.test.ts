import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceMapPath = path.resolve(
  process.cwd(),
  'lib/extensions/_generated/workspace-map.tsx',
)

describe('generated extension workspace registry', () => {
  it('uses static workspace imports so enabled workspaces render during hydration', () => {
    const source = fs.readFileSync(workspaceMapPath, 'utf8')

    expect(source).not.toContain("from 'next/dynamic'")
    expect(source).not.toContain('dynamic(() => import(')
    expect(source).toContain(
      "import ArcimMigrationWorkspace from '@/components/extensions/general/ArcimMigrationWorkspace'",
    )
    expect(source).toContain(
      "'general/arcim-migration': ArcimMigrationWorkspace,",
    )
  })
})
