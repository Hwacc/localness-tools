import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const sdk = (path: string) =>
  fileURLToPath(new URL(`../sdk/src/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: '@localness/sdk/sync', replacement: sdk('sync/index.ts') },
      { find: '@localness/sdk/review', replacement: sdk('review/index.ts') },
      { find: '@localness/sdk', replacement: sdk('index.ts') },
    ],
  },
})
