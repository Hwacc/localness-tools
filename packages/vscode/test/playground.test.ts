import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compilePatterns,
  DEFAULT_KEY_PATTERNS,
  extractKeys,
} from '../src/core/extract'

// Keep in sync with the keyPatterns snippet in playground/README.md.
const CUSTOM_PATTERNS = [
  String.raw`(?<![\w$.])translate\(\s*'([^'\\\n]+)'`,
  String.raw`(?<![\w$.])L\(\s*"([^"\\\n]+)"`,
]

const root = fileURLToPath(new URL('../../../playground/src', import.meta.url))
const MARKER = /EXPECT:\s*(detected|not-detected|custom-detected)\s+(\S+)/g

function keysIn(text: string, sources: readonly string[]) {
  const { regexes } = compilePatterns(sources)
  return new Set(extractKeys(text, regexes).map((match) => match.key))
}

describe('playground EXPECT markers', () => {
  const files = readdirSync(root).filter((name) =>
    /\.(ts|tsx|js|vue|html)$/.test(name),
  )

  it('finds fixture files', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  for (const name of files) {
    it(name, () => {
      const text = readFileSync(join(root, name), 'utf8')
      const defaults = keysIn(text, DEFAULT_KEY_PATTERNS)
      const withCustom = keysIn(text, [
        ...DEFAULT_KEY_PATTERNS,
        ...CUSTOM_PATTERNS,
      ])
      for (const [, kind, key] of text.matchAll(MARKER)) {
        if (kind === 'detected') expect(defaults, key).toContain(key)
        else if (kind === 'not-detected')
          expect(withCustom, key).not.toContain(key)
        else {
          expect(defaults, key).not.toContain(key)
          expect(withCustom, key).toContain(key)
        }
      }
    })
  }
})
