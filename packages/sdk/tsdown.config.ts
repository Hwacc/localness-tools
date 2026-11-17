import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', sync: 'src/sync/index.ts' },
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node18',
  dts: true,
  clean: true,
})
