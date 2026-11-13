import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  dts: false,
  clean: true,
})
