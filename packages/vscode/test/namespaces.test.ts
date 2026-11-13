import { describe, expect, it } from 'vitest'
import {
  firstSegment,
  groupByNamespace,
  namespaceOf,
} from '../src/core/namespaces'
import { isValidBaseUrl, keyUrl, trimBaseUrl } from '../src/core/urls'

describe('namespaceOf', () => {
  const names = ['app', 'app_admin', 'common']

  it('needs a boundary after the name', () => {
    expect(namespaceOf('app.title', names)).toBe('app')
    expect(namespaceOf('app_title', names)).toBe('app')
    expect(namespaceOf('app:title', names)).toBe('app')
    expect(namespaceOf('app/title', names)).toBe('app')
    expect(namespaceOf('app-title', names)).toBe('app')
    expect(namespaceOf('apple.title', names)).toBeNull()
    expect(namespaceOf('app', names)).toBeNull()
  })

  it('prefers the longest name and is case-sensitive', () => {
    expect(namespaceOf('app_admin.title', names)).toBe('app_admin')
    expect(namespaceOf('App.title', names)).toBeNull()
  })
})

describe('groupByNamespace', () => {
  const items = ['b.two', 'a.one', 'b.one', 'plain'].map((key) => ({ key }))

  it('uses declared namespaces in declared order and ungrouped last', () => {
    const groups = groupByNamespace(items, ['b', 'a', 'unused'])
    expect(groups.map((group) => group.name)).toEqual(['b', 'a', null])
    expect(groups[0]?.items.map((item) => item.key)).toEqual(['b.one', 'b.two'])
  })

  it('falls back to the first segment when none are declared', () => {
    const groups = groupByNamespace(items, [])
    expect(groups.map((group) => group.name)).toEqual(['a', 'b', null])
    expect(groups[2]?.items.map((item) => item.key)).toEqual(['plain'])
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
