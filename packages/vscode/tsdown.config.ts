import { defineConfig } from 'tsdown'
import { FLAG_REGIONS } from './src/core/locales.ts'

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  dts: false,
  clean: true,
  copy: [
    {
      from: FLAG_REGIONS.map(
        (region) => `node_modules/flag-icons/flags/4x3/${region}.svg`,
      ),
      to: 'dist/flags',
    },
  ],
})
