import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type ExtensionPreset = {
  extensions: string[]
}

function readPreset(name: string): ExtensionPreset {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `docker/extensions.${name}.json`), 'utf8'),
  ) as ExtensionPreset
}

describe('Docker extension presets', () => {
  it('includes Systemmigration in the self-hosted production image', () => {
    expect(readPreset('self-hosted').extensions).toContain('arcim-migration')
  })
})
