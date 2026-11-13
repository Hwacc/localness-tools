import {
  LocalnessError,
  type DeliveryKeyState,
  type DeliveryMeta,
} from '@localness/sdk'
import { describe, expect, it } from 'vitest'
import {
  buildProjectData,
  projectSetting,
  resolveLocales,
} from '../src/core/data'
import { describeError } from '../src/core/errors'
import {
  buildHoverInfo,
  escapeMarkdown,
  renderHoverMarkdown,
} from '../src/core/hover'
import {
  buildIndex,
  findMissingKeys,
  hintOffset,
  hintText,
  isRevealed,
  searchCached,
  stateFor,
  textFor,
  truncate,
} from '../src/core/keys'

function state(
  id: number,
  key: string,
  locales: DeliveryKeyState['locales'],
  extra: Partial<DeliveryKeyState> = {},
): DeliveryKeyState {
  return { id, key, releaseIds: [], draft: false, locales, ...extra }
}

const welcome = state(
  1,
  'app.welcome',
  {
    en: { draftText: null, publishedText: 'Welcome', state: 'published' },
    ja: { draftText: 'ようこそ', publishedText: null, state: 'draft' },
  },
  { releaseIds: [7, 9] },
)
const bye = state(2, 'app.bye', {
  en: { draftText: null, publishedText: 'Goodbye', state: 'published' },
})
const keys = [welcome, bye]

describe('key state helpers', () => {
  it('prefers draft text and defaults missing locales to unpublished', () => {
    expect(textFor(welcome, 'ja')).toBe('ようこそ')
    expect(textFor(welcome, 'en')).toBe('Welcome')
    expect(textFor(bye, 'ja')).toBeUndefined()
    expect(stateFor(bye, 'ja')).toBe('unpublished')
    expect(stateFor(welcome, 'ja')).toBe('draft')
  })

  it('finds keys missing from the index', () => {
    const index = buildIndex(keys)
    const matches = [
      { key: 'app.bye', start: 0, end: 7 },
      { key: 'nope', start: 10, end: 14 },
    ]
    expect(findMissingKeys(matches, index).map((m) => m.key)).toEqual(['nope'])
  })

  it('ranks search results and respects the limit', () => {
    const options = { sourceLocale: 'en', displayLocale: 'ja', limit: 10 }
    expect(searchCached(keys, 'app.bye', options)[0]?.key).toBe('app.bye')
    expect(searchCached(keys, 'goodbye', options).map((s) => s.key)).toEqual([
      'app.bye',
    ])
    expect(searchCached(keys, 'ようこそ', options).map((s) => s.key)).toEqual([
      'app.welcome',
    ])
    expect(searchCached(keys, 'app', { ...options, limit: 1 })).toHaveLength(1)
    expect(searchCached(keys, '  ', options)).toEqual([])
  })

  it('truncates and flattens hint text', () => {
    expect(truncate('a  b\nc', 10)).toBe('a b c')
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
    expect(hintText(bye, 'ja', 20)).toBe('(no translation)')
    expect(hintText(welcome, 'ja', 20)).toBe('ようこそ')
  })

  it('anchors hints after the closing quote', () => {
    expect(hintOffset(`t('abc')`, { key: 'abc', start: 3, end: 6 })).toBe(7)
    expect(hintOffset(`k=abc `, { key: 'abc', start: 2, end: 5 })).toBe(5)
  })

  it('reveals a replaced key while a selection overlaps it', () => {
    const key = { start: 3, end: 4 }
    expect(isRevealed(key, [])).toBe(false)
    expect(isRevealed(key, [{ start: 3, end: 3 }])).toBe(true)
    expect(isRevealed(key, [{ start: 4, end: 4 }])).toBe(true)
    expect(isRevealed(key, [{ start: 5, end: 5 }])).toBe(false)
    expect(isRevealed(key, [{ start: 0, end: 2 }])).toBe(false)
    expect(isRevealed(key, [{ start: 0, end: 10 }])).toBe(true)
  })
})

describe('hover', () => {
  const context = {
    sourceLocale: 'en',
    displayLocale: 'ja',
    releaseNames: new Map([[7, 'v1']]),
    url: 'https://localness.example.com/translations?project=1&key=1&scope=all',
  }

  it('collects texts, state, releases and url', () => {
    const info = buildHoverInfo(welcome, context)
    expect(info).toMatchObject({
      sourceText: 'Welcome',
      displayText: 'ようこそ',
      state: 'draft',
      releases: ['v1 (#7)', '#9'],
    })
  })

  it('renders markdown with the link and escapes text', () => {
    const markdown = renderHoverMarkdown(buildHoverInfo(welcome, context))
    expect(markdown).toContain(
      '[Open in Localness](https://localness.example.com',
    )
    expect(markdown).toContain('State: draft')
    expect(markdown).toContain('v1 \\(\\#7\\), \\#9')
    expect(escapeMarkdown('*a* <b>')).toBe('\\*a\\* \\<b\\>')
  })

  it('shows none for missing translations and skips a duplicate locale', () => {
    const missing = renderHoverMarkdown(buildHoverInfo(bye, context))
    expect(missing).toContain('_none_')
    const same = renderHoverMarkdown(
      buildHoverInfo(bye, { ...context, displayLocale: 'en' }),
    )
    expect(same.match(/Goodbye/g)).toHaveLength(1)
  })
})

describe('project data', () => {
  const meta = {
    project: { id: 5, name: 'web' },
    locales: ['en', 'ja', 'fr'],
    sourceLocale: 'en',
    localeFallback: 'en',
    release: null,
    releases: [{ id: 7, name: 'v1', sort: 0 }],
    namespaces: [{ id: 1, name: 'app', sort: 0 }],
    coverage: { keys: 2, projectKeys: 2, publishedPerLocale: {} },
    canManageReleases: false,
    generatedAt: '',
  } satisfies DeliveryMeta

  it('picks the display locale', () => {
    expect(resolveLocales(meta, 'fr').displayLocale).toBe('fr')
    expect(resolveLocales(meta, '').displayLocale).toBe('ja')
    expect(resolveLocales(meta, 'xx').fetch).toEqual(['en', 'ja'])
    expect(resolveLocales({ ...meta, locales: ['en'] }, '').fetch).toEqual([
      'en',
    ])
  })

  it('falls back to localeFallback when sourceLocale is absent', () => {
    const { sourceLocale: _omit, ...rest } = meta
    expect(resolveLocales(rest, '').sourceLocale).toBe('en')
  })

  it('builds the in-memory model', () => {
    const data = buildProjectData(
      meta,
      { sourceLocale: 'en', keys, total: 2, generatedAt: '' },
      resolveLocales(meta, 'ja'),
      123,
    )
    expect(data.namespaces).toEqual(['app'])
    expect(data.releaseNames.get(7)).toBe('v1')
    expect(data.index.get('app.bye')).toBe(bye)
  })

  it('stores a project name only when it is unique', () => {
    const a = { id: 1, name: 'web' }
    const b = { id: 2, name: 'web' }
    const c = { id: 3, name: 'api' }
    expect(projectSetting([a, c], a)).toBe('web')
    expect(projectSetting([a, b, c], a)).toBe('1')
  })
})

describe('describeError', () => {
  it.each([
    ['auth', 'Authentication failed'],
    ['forbidden', 'Access denied'],
    ['ambiguous-project', 'more than one project'],
    ['network', 'https://localness.example.com'],
  ] as const)('explains %s', (code, expected) => {
    const message = describeError(
      new LocalnessError(code, 'x'),
      'https://localness.example.com',
    )
    expect(message).toContain(expected)
  })

  it('passes other errors through', () => {
    expect(describeError(new Error('boom'), 'u')).toBe('boom')
  })
})
