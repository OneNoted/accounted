#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SW_PATH = join(process.cwd(), 'public', 'sw.js')
const PLACEHOLDER = '__NEXT_PUBLIC_BRANDING_APP_NAME__'
const value = process.env.NEXT_PUBLIC_BRANDING_APP_NAME || 'Gnubok'

if (!existsSync(SW_PATH)) {
  console.log(`[inject-public-branding] ${SW_PATH} not found, skipping`)
  process.exit(0)
}

const source = readFileSync(SW_PATH, 'utf8')
if (!source.includes(PLACEHOLDER)) {
  console.log(`[inject-public-branding] no placeholder in public/sw.js, skipping`)
  process.exit(0)
}

writeFileSync(SW_PATH, source.split(PLACEHOLDER).join(value))
console.log(`[inject-public-branding] stamped public/sw.js with "${value}"`)
