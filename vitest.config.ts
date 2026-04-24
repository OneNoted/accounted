import { defineConfig } from 'vitest/config'
import path from 'path'

const alias = { '@': path.resolve(__dirname, '.') }

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.pg.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'pg-real',
          globals: true,
          environment: 'node',
          include: ['**/*.pg.test.ts'],
          exclude: ['**/node_modules/**'],
          setupFiles: ['tests/pg/setup.ts'],
          // One-connection-at-a-time to avoid cross-file DB contention.
          fileParallelism: false,
          testTimeout: 15000,
        },
      },
    ],
  },
})
