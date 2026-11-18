import { describe, expect, it } from 'vitest'
import { findKey } from '../src/core/localeFile'

describe('findKey', () => {
  it('finds a flat key', () => {
    const source = '{\n  "home.title": "Home",\n  "home": "x"\n}'
    expect(findKey(source, 'home.title')).toBe(source.indexOf('"home.title"'))
  })

  it('walks nested segments in order', () => {
    const source =
      '{\n  "title": "Top",\n  "home": {\n    "home": {\n      "title": "Nested"\n    }\n  }\n}'
    expect(findKey(source, 'home.home.title')).toBe(
      source.lastIndexOf('"title"'),
    )
  })

  it('returns undefined for a missing key', () => {
    expect(findKey('{ "a": { "b": "x" } }', 'a.c')).toBeUndefined()
  })
})
