import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { reviewPage } from '../src/review'
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

  it('embeds a script that parses, for each kind of page', () => {
    for (const kind of ['extract', 'resolve', 'plan'] as const) {
      const html = reviewPage({ host: 'browser', token: 'tok', kind })
      const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
      expect(script, kind).toBeTruthy()
      expect(() => new Function(script!)).not.toThrow()
    }
  })
})
