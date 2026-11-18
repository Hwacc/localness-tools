import { describe, expect, it } from 'vitest'
import { firstSegment, groupByNamespace } from '../src/core/namespaces'
import { isValidBaseUrl, keyUrl, trimBaseUrl } from '../src/core/urls'

describe('groupByNamespace', () => {
  const items = ['b.two', 'a.one', 'b.one', 'plain'].map((key) => ({ key }))

  it('uses declared namespaces in declared order and ungrouped last', () => {
    const groups = groupByNamespace(items, ['b', 'a', 'unused'], '')
    expect(groups.map((group) => group.name)).toEqual(['b', 'a', null])
    expect(groups[0]?.items.map((item) => item.key)).toEqual(['b.one', 'b.two'])
  })

  it('falls back to the first segment when none are declared', () => {
    const groups = groupByNamespace(items, [], '')
    expect(groups.map((group) => group.name)).toEqual(['a', 'b', null])
    expect(groups[2]?.items.map((item) => item.key)).toEqual(['plain'])
  })

  it('matches names after the project prefix', () => {
    const keys = ['web.home.title', 'web.cart_total', 'home.legacy', 'web.x']
    const items = keys.map((key) => ({ key }))
    const declared = groupByNamespace(items, ['home', 'cart'], 'web')
    expect(declared.map((group) => group.name)).toEqual(['home', 'cart', null])
    expect(declared[0]?.items.map((item) => item.key)).toEqual([
      'home.legacy',
      'web.home.title',
    ])
    const segments = groupByNamespace(items, [], 'web')
    expect(segments.map((group) => group.name)).toEqual(['cart', 'home', null])
    expect(segments[2]?.items.map((item) => item.key)).toEqual(['web.x'])
  })
})

describe('firstSegment', () => {
  it('stops at the first boundary', () => {
    expect(firstSegment('hour_ago')).toBe('hour')
    expect(firstSegment('plain')).toBe('plain')
    expect(firstSegment('.x')).toBe('')
  })
})

describe('urls', () => {
  it('builds the platform key url', () => {
    expect(
      keyUrl({
        baseUrl: 'https://localness.example.com/',
        projectId: 3,
        keyId: 42,
      }),
    ).toBe(
      'https://localness.example.com/translations?project=3&key=42&scope=all',
    )
  })

  it('trims and validates base urls', () => {
    expect(trimBaseUrl(' https://x.example.com// ')).toBe(
      'https://x.example.com',
    )
    expect(isValidBaseUrl('https://x.example.com')).toBe(true)
    expect(isValidBaseUrl('x.example.com')).toBe(false)
    expect(isValidBaseUrl('ftp://x.example.com')).toBe(false)
  })
})
