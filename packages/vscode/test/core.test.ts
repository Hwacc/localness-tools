import {
  LocalnessError,
  type DeliveryKeyState,
  type DeliveryMeta,
} from '@localness/sdk'
import { describe, expect, it } from 'vitest'
import type { DiffKind } from '@localness/sdk/sync'
import {
  buildProjectData,
  projectSetting,
  resolveLocales,
} from '../src/core/data'
import { describeError } from '../src/core/errors'
import { localeIcon, localeName } from '../src/core/locales'
import { filterByRelease, releaseChanges } from '../src/core/releases'
import {
  buildHoverInfo,
  buildLocalHoverInfo,
  escapeMarkdown,
  renderHoverMarkdown,
} from '../src/core/hover'
import {
  buildIndex,
  editableText,
  findMissingKeys,
  hintOffset,
  hintText,
  isRevealed,
  localOnlyTexts,
  publishedBehind,
  replaceKeyState,
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

  it('edits from the draft and reports a published text it hides', () => {
    expect(editableText(welcome, 'ja')).toEqual({
      text: 'ようこそ',
      expected: 'ようこそ',
    })
    expect(editableText(welcome, 'en')).toEqual({
      text: 'Welcome',
      expected: '',
    })
    expect(editableText(bye, 'ja')).toEqual({ text: '', expected: '' })
    expect(publishedBehind(welcome, 'en')).toBeUndefined()
    const edited = state(1, 'app.welcome', {
      en: { draftText: 'Hi', publishedText: 'Welcome', state: 'published' },
    })
    expect(publishedBehind(edited, 'en')).toBe('Welcome')
  })

  it('replaces a key state by id or appends it', () => {
    const renamed = { ...welcome, key: 'app.hello' }
    expect(replaceKeyState(keys, renamed)).toEqual([renamed, bye])
    const extra = state(3, 'app.new', {})
    expect(replaceKeyState(keys, extra)).toEqual([welcome, bye, extra])
    expect(keys).toEqual([welcome, bye])
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
    expect(hintText(textFor(bye, 'ja'), 20)).toBe('(no translation)')
    expect(hintText(textFor(welcome, 'ja'), 20)).toBe('ようこそ')
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

  it('lists the source first, then the display locale, once', () => {
    const info = buildHoverInfo(welcome, context)
    expect(info.locales).toEqual([
      {
        locale: 'en',
        isSource: true,
        text: 'Welcome',
        published: undefined,
        state: 'published',
      },
      {
        locale: 'ja',
        isSource: false,
        text: 'ようこそ',
        published: undefined,
        state: 'draft',
      },
    ])
    expect(info.releases).toEqual(['v1 (#7)', '#9'])
    const same = buildHoverInfo(bye, { ...context, displayLocale: 'en' })
    expect(same.locales.map((entry) => entry.locale)).toEqual(['en'])
  })

  it('renders sections with badges, edit links and the footer', () => {
    const markdown = renderHoverMarkdown(buildHoverInfo(welcome, context), {
      edit: (locale) => `[e:${locale}]`,
      title: ['[c]'],
      footer: ['[Other]'],
    })
    const sections = markdown.split('\n\n---\n\n')
    expect(sections).toHaveLength(4)
    expect(sections[0]).toMatch(
      /\*\*`app\.welcome`\*\* \[c\] \[\$\(link-external\)\]\(https:[^ ]+ "Open in Localness"\)/,
    )
    expect(sections[0]).toContain('Releases: v1 \\(\\#7\\), \\#9')
    expect(sections[1]).toMatch(/^\*\*EN\*\* · Source.*Published.*\[e:en\]/)
    expect(sections[2]).toMatch(/^\*\*JA\*\* · .*\$\(edit\) Edited.*\[e:ja\]/)
    expect(sections[3]).toBe('[Other]')
    expect(
      renderHoverMarkdown(buildHoverInfo(bye, context)).split('\n\n---\n\n'),
    ).toHaveLength(3)
    expect(escapeMarkdown('*a* <b>')).toBe('\\*a\\* \\<b\\>')
  })

  it('marks missing text and the published text behind an edit', () => {
    expect(renderHoverMarkdown(buildHoverInfo(bye, context))).toContain(
      '> _No text_',
    )
    const edited = state(
      3,
      'app.edited',
      {
        en: { draftText: 'Hi!', publishedText: 'Hi', state: 'draft' },
        ja: { draftText: 'やあ', publishedText: 'やあ', state: 'published' },
      },
      { draft: true },
    )
    const markdown = renderHoverMarkdown(buildHoverInfo(edited, context))
    expect(markdown).toContain('Unpublished changes')
    expect(markdown).toContain('> Hi\\!\n>\n> _Published:_ Hi')
    expect(markdown.match(/_Published:_/g)).toHaveLength(1)
  })

  it('renders a key only in the locale files without project links', () => {
    const sections = renderHoverMarkdown(
      buildLocalHoverInfo('app.new', { en: 'New', ja: '新しい' }, context),
    ).split('\n\n---\n\n')
    expect(sections[0]).not.toContain('Open in Localness')
    expect(sections[0]).toContain('Only in the locale files')
    expect(sections[0]).not.toContain('Releases')
    expect(sections[1]).toMatch(/Not pushed/)
    expect(sections[2]).toContain('> 新しい')
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
    expect(data.release).toBeNull()
  })

  it('resolves the config release by name', () => {
    const states = { sourceLocale: 'en', keys, total: 2, generatedAt: '' }
    const locales = resolveLocales(meta, 'ja')
    const data = buildProjectData(meta, states, locales, 1, 'V1')
    expect(data.release).toEqual({ id: 7, name: 'v1' })
    expect(buildProjectData(meta, states, locales, 1, 'v9')).toMatchObject({
      release: null,
      missingRelease: 'v9',
    })
  })

  it('stores a project name only when it is unique', () => {
    const a = { id: 1, name: 'web' }
    const b = { id: 2, name: 'web' }
    const c = { id: 3, name: 'api' }
    expect(projectSetting([a, c], a)).toBe('web')
    expect(projectSetting([a, b, c], a)).toBe(1)
  })
})

describe('releases', () => {
  const key = (id: number, releaseIds: number[]) =>
    ({ id, key: `k${id}`, releaseIds }) as unknown as DeliveryKeyState
  const a = key(1, [7])
  const b = key(2, [7, 8])
  const c = key(3, [])

  it('filters keys by release or by having none', () => {
    expect(filterByRelease([a, b, c], 8)).toEqual([b])
    expect(filterByRelease([a, b, c], 'unassigned')).toEqual([c])
    expect(filterByRelease([a, b, c], undefined)).toHaveLength(3)
  })

  it('adds picks, removes releases every key had, keeps partial ones', () => {
    expect(releaseChanges([a, b], [7, 8, 9], new Set([9]))).toEqual([
      { releaseId: 7, mode: 'remove', keyIds: [1, 2] },
      { releaseId: 9, mode: 'add', keyIds: [1, 2] },
    ])
    expect(releaseChanges([a, b], [7, 8], new Set([7, 8]))).toEqual([
      { releaseId: 8, mode: 'add', keyIds: [1] },
    ])
    expect(releaseChanges([b], [7, 8], new Set([7, 8]))).toEqual([])
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

  it('explains a read-only token and a conflict', () => {
    const readOnly = new LocalnessError('forbidden', 'x', {
      serverMessage: 'This API token is read-only',
    })
    expect(describeError(readOnly, 'u')).toContain('Read & write token')
    const taken = new LocalnessError('conflict', 'x', {
      serverMessage: 'Key already exists',
    })
    expect(describeError(taken, 'u')).toBe('Conflict (Key already exists).')
  })
})

describe('locales', () => {
  it('names locales in their own language', () => {
    expect(localeName('de')).toBe('Deutsch')
    expect(localeName('ja')).toBe('日本語')
    expect(localeName('not a locale')).toBe('not a locale')
  })

  it('names Chinese by script', () => {
    for (const locale of ['zh', 'zh_CN', 'zh-SG', 'zh-Hans'])
      expect(localeName(locale)).toBe('中文（简体）')
    for (const locale of ['zh_tw', 'zh-HK', 'zh-Hant'])
      expect(localeName(locale)).toBe('中文（繁体）')
  })

  it('picks a flag or script badge', () => {
    expect(localeIcon('ja')).toBe('dist/flags/jp.svg')
    expect(localeIcon('en')).toBe('dist/flags/us.svg')
    expect(localeIcon('zh_CN')).toBe('media/zh-hans.svg')
    expect(localeIcon('zh-TW')).toBe('media/zh-hant.svg')
    expect(localeIcon('es-419')).toBeUndefined()
    expect(localeIcon('is')).toBeUndefined()
    expect(localeIcon('not a locale')).toBeUndefined()
  })
})

describe('localOnlyTexts', () => {
  it('groups the texts of keys only the locale files add', () => {
    const entry = (
      key: string,
      locale: string,
      kind: DiffKind,
      local: string | null,
    ) => ({ key, locale, kind, local })
    const texts = localOnlyTexts([
      entry('home.new', 'en', 'local-added', 'New'),
      entry('home.new', 'ja', 'local-added', '新しい'),
      entry('home.gone', 'en', 'platform-deleted', 'Gone'),
      entry('home.title', 'en', 'local-changed', 'Title'),
    ])
    expect([...texts]).toEqual([['home.new', { en: 'New', ja: '新しい' }]])
  })
})
