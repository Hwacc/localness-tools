import { describe, expect, it, vi } from 'vitest'
import {
  compilePatterns,
  DEFAULT_KEY_PATTERNS,
  extractKeys,
  patternSources,
} from '../src/core/extract'

function keys(text: string, sources: readonly string[] = DEFAULT_KEY_PATTERNS) {
  const { regexes } = compilePatterns(sources)
  return extractKeys(text, regexes).map((match) => match.key)
}

describe('default key patterns', () => {
  it('recognises t, $t and i18n.t in all quote styles', () => {
    expect(keys(`t('a.b') t("c.d") t(\`e.f\`)`)).toEqual(['a.b', 'c.d', 'e.f'])
    expect(keys(`$t('a') this.$t('b') i18n.t('c') i18n.global.t('d')`)).toEqual(
      ['a', 'b', 'c', 'd'],
    )
  })

  it('allows whitespace after the paren and extra arguments', () => {
    expect(keys(`t( 'a', { n: 1 })`)).toEqual(['a'])
  })

  it('recognises i18n-t keypath, including multi-line tags', () => {
    expect(keys(`<i18n-t keypath="a.b" tag="p">`)).toEqual(['a.b'])
    expect(keys(`<i18n-t\n  tag="p"\n  keypath='c.d'\n>`)).toEqual(['c.d'])
  })

  it('ignores dynamic keys and bound keypaths', () => {
    expect(keys('t(`a.${name}`)')).toEqual([])
    expect(keys(`<i18n-t :keypath="'a'">`)).toEqual([])
    expect(keys(`t(key)`)).toEqual([])
  })

  it('ignores lookalike identifiers', () => {
    expect(keys(`format('a') split('b') obj.t('c') $format('d')`)).toEqual([])
  })

  it('reports offsets of the key text', () => {
    const text = `x = t('hello')`
    const { regexes } = compilePatterns(DEFAULT_KEY_PATTERNS)
    const [match] = extractKeys(text, regexes)
    expect(text.slice(match!.start, match!.end)).toBe('hello')
  })

  it('does not report one position twice', () => {
    const { regexes } = compilePatterns([
      ...DEFAULT_KEY_PATTERNS,
      String.raw`\bt\('([^']+)'\)`,
    ])
    expect(extractKeys(`t('a')`, regexes)).toHaveLength(1)
  })
})

describe('key offsets', () => {
  function ranges(
    text: string,
    sources: readonly string[] = DEFAULT_KEY_PATTERNS,
  ) {
    const { regexes } = compilePatterns(sources)
    return extractKeys(text, regexes).map(({ key, start, end }) => ({
      key,
      start,
      end,
      slice: text.slice(start, end),
    }))
  }

  it('is exact when the key text also appears earlier in the match', () => {
    expect(ranges(`t('t')`)).toEqual([
      { key: 't', start: 3, end: 4, slice: 't' },
    ])
    expect(ranges(`i18n.t('i18n')`)).toEqual([
      { key: 'i18n', start: 8, end: 12, slice: 'i18n' },
    ])
    expect(ranges(`<i18n-t keypath="keypath">`)).toEqual([
      { key: 'keypath', start: 17, end: 24, slice: 'keypath' },
    ])
  })

  it('handles several keys, quote styles and multi-line calls', () => {
    const text = "t('a') t(\"b\") t(`c`)\nt(\n  'd')"
    expect(ranges(text).map((r) => [r.key, r.slice])).toEqual([
      ['a', 'a'],
      ['b', 'b'],
      ['c', 'c'],
      ['d', 'd'],
    ])
    expect(ranges(text).map((r) => r.start)).toEqual([
      3,
      10,
      17,
      text.indexOf("'d'") + 1,
    ])
  })

  it('is exact for custom patterns with earlier groups and repeats', () => {
    expect(ranges('tr:tr:x', [String.raw`tr:(?:tr:)?(x)`])).toEqual([
      { key: 'x', start: 6, end: 7, slice: 'x' },
    ])
    expect(ranges('x aaa(a)', [String.raw`(?<n>a+)\((a)\)`])).toEqual([
      { key: 'aaa', start: 2, end: 5, slice: 'aaa' },
    ])
    expect(
      ranges('[a] [a]', [String.raw`\[([a])\]`]).map((r) => r.start),
    ).toEqual([1, 5])
  })

  it('does not use the d flag or match.indices', () => {
    const flags: string[] = []
    const Original = RegExp
    const Spy = new Proxy(Original, {
      construct(target, args: [string, string?]) {
        flags.push(args[1] ?? '')
        return new target(...args)
      },
    })
    vi.stubGlobal('RegExp', Spy)
    try {
      const { regexes } = compilePatterns(DEFAULT_KEY_PATTERNS)
      const found = extractKeys(`t('t') t('a')`, regexes)
      expect(found.map((m) => m.start)).toEqual([3, 10])
    } finally {
      vi.unstubAllGlobals()
    }
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.some((f) => f.includes('d'))).toBe(false)
  })
})

describe('custom patterns', () => {
  it('extends the defaults', () => {
    const sources = patternSources([String.raw`\btr\("([^"]+)"\)`], true)
    expect(keys(`t('a') tr("b")`, sources)).toEqual(['a', 'b'])
  })

  it('replaces the defaults when they are off', () => {
    const sources = patternSources([String.raw`\btr\("([^"]+)"\)`], false)
    expect(keys(`t('a') tr("b")`, sources)).toEqual(['b'])
  })

  it('reports invalid regexes and keeps the rest', () => {
    const { regexes, errors } = compilePatterns(['(', 'ok\\(([a-z]+)\\)'])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.source).toBe('(')
    expect(extractKeys('ok(abc)', regexes).map((m) => m.key)).toEqual(['abc'])
  })

  it('survives patterns that match the empty string', () => {
    const { regexes } = compilePatterns(['(x)?'])
    expect(extractKeys('abc x', regexes).map((m) => m.key)).toEqual(['x'])
  })
})
