import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildPages } from '../scripts/build-pages'

describe('page bundle', () => {
  it('matches the committed generator output', async () => {
    const fresh = await buildPages()
    const committed = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../src/review/page/bundle.gen.ts',
      ),
      'utf8',
    )
    expect(fresh).toBe(committed)
  })
})
