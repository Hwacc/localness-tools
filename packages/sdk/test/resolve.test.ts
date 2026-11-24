import { describe, expect, it } from 'vitest'
import { reviewPage } from '../src/review'
import type { DiffEntry } from '../src/sync/diff'
import {
  buildResolveRows,
  checkResolveDecisions,
  resolveCommands,
  toResolveResult,
  type ResolveCell,
  type ResolveReviewDoc,
  type ResolveSource,
} from '../src/review/resolve'

function entry(
  patch: Partial<DiffEntry> & Pick<DiffEntry, 'key' | 'kind'>,
): DiffEntry {
  return {
    locale: 'en',
    local: 'local',
    platform: 'remote',
    draft: 'remote',
    base: null,
    onPlatform: true,
    target: { dir: 'locales', by: 'existing' },
    locations: [
      {
        dir: 'locales',
        relativePath: 'en.json',
        path: ['title'],
        value: 'local',
      },
    ],
    dirs: ['locales'],
    ...patch,
  }
}

function source(
  entries: DiffEntry[],
  base: unknown = { en: {} },
): ResolveSource {
  return {
    entries,
    base,
    files: [
      {
        locale: 'en',
        dir: 'locales',
        relativePath: 'en.json',
        path: '/repo/locales/en.json',
      },
      {
        locale: 'ja',
        dir: 'locales',
        relativePath: 'ja.json',
        path: '/repo/locales/ja.json',
      },
      {
        locale: 'en',
        dir: 'locales/boost',
        relativePath: 'boost/en.json',
        path: '/repo/locales/boost/en.json',
      },
    ],
  }
}

function doc(rows: ResolveReviewDoc['rows']): ResolveReviewDoc {
  return {
    kind: 'resolve',
    id: 'abcd1234',
    createdAt: 'now',
    project: 'Web',
    sourceLocale: 'en',
    editor: 'vscode',
    config: 'app/localness.config.json',
    hasBase: true,
    dirs: ['locales', 'locales/boost'],
    empties: [],
    rows,
  }
}

describe('review pages', () => {
  it('embeds a script that parses, for both kinds', () => {
    for (const kind of ['extract', 'resolve'] as const) {
      const html = reviewPage({ host: 'browser', token: 'tok', kind })
      const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]
      expect(script, kind).toBeTruthy()
      expect(() => new Function(script!)).not.toThrow()
      expect(html).toContain('data-host="browser"')
      expect(html).toContain('data-token="tok"')
    }
    const webview = reviewPage({
      host: 'webview',
      nonce: 'abc',
      kind: 'resolve',
    })
    expect(webview).toContain('nonce="abc"')
    expect(webview).toContain('data-host="webview"')
    expect(webview).toContain('Resolve differences')
  })

  it('escapes the browser token', () => {
    const html = reviewPage({
      host: 'browser',
      token: 'a"b&c',
      kind: 'extract',
    })
    expect(html).toContain('data-token="a&quot;b&amp;c"')
  })
})

describe('buildResolveRows', () => {
  it('groups the kinds a person decides and drops the rest', () => {
    const built = buildResolveRows(
      source([
        entry({ key: 'title', kind: 'different', locale: 'ja' }),
        entry({ key: 'title', kind: 'conflict', locale: 'en', base: 'old' }),
        entry({
          key: 'gone',
          kind: 'platform-deleted',
          onPlatform: false,
          platform: null,
          draft: null,
        }),
        entry({
          key: 'added',
          kind: 'platform-added',
          local: null,
          locations: [],
          dirs: [],
        }),
        entry({
          key: 'blank',
          kind: 'empty',
          local: '',
          platform: null,
          draft: null,
          onPlatform: false,
        }),
        entry({
          key: 'fresh',
          kind: 'platform-added',
          local: null,
          locations: [],
          dirs: [],
          target: { dir: null, by: 'unrouted' },
        }),
      ]),
    )
    expect(built.hasBase).toBe(true)
    expect(built.dirs).toEqual(['locales', 'locales/boost'])
    expect(built.empties).toEqual([{ key: 'blank', locale: 'en' }])
    expect(
      built.rows.map((row) => [
        row.index,
        row.key,
        row.cells.map((cell) => cell.locale),
      ]),
    ).toEqual([
      [1, 'fresh', ['en']],
      [2, 'gone', ['en']],
      [3, 'title', ['en', 'ja']],
    ])
    const title = built.rows[2]!
    expect(title.cells.map((cell) => cell.allowed)).toEqual([
      ['pull', 'push', 'skip'],
      ['pull', 'push', 'skip'],
    ])
    expect(title.cells.map((cell) => cell.newer)).toEqual([null, null])
    expect(built.rows[0]!.cells[0]).toMatchObject({
      allowed: ['pull', 'skip'],
      needsInto: true,
      newer: 'remote',
    })
    expect(built.rows[1]!.cells[0]!.allowed).toEqual(['prune', 'push', 'skip'])
    expect(title.cells[0]!.locations[0]!.path).toBe('/repo/locales/en.json')
  })

  it('asks for a directory only when a pull has nowhere to go', () => {
    const built = buildResolveRows(
      source([
        entry({
          key: 'split',
          kind: 'duplicate',
          locations: [],
          dirs: ['locales', 'locales/boost'],
        }),
        entry({
          key: 'copied',
          kind: 'duplicate',
          locations: [
            {
              dir: 'locales',
              relativePath: 'en.json',
              path: ['copied'],
              value: 'A',
            },
            {
              dir: 'locales/boost',
              relativePath: 'boost/en.json',
              path: ['copied'],
              value: 'B',
            },
          ],
          dirs: ['locales', 'locales/boost'],
        }),
      ]),
    )
    expect(
      built.rows.map((row) => [
        row.key,
        row.cells[0]!.needsInto,
        row.cells[0]!.allowed,
      ]),
    ).toEqual([
      ['copied', false, ['pull', 'skip']],
      ['split', true, ['pull', 'skip']],
    ])
  })

  it('treats a missing base as the first sync', () => {
    expect(buildResolveRows(source([], null)).hasBase).toBe(false)
  })
})

describe('checkResolveDecisions', () => {
  const built = buildResolveRows(
    source([
      entry({ key: 'title', kind: 'different' }),
      entry({
        key: 'fresh',
        kind: 'platform-added',
        local: null,
        locations: [],
        dirs: [],
        target: { dir: null, by: 'unrouted' },
      }),
      entry({
        key: 'gone',
        kind: 'platform-deleted',
        onPlatform: false,
        platform: null,
        draft: null,
      }),
    ]),
  )
  const review = doc(built.rows)

  it('rejects an action the kind does not allow, a missing directory and an unknown one', () => {
    // Rows are fresh, gone, title.
    expect(
      checkResolveDecisions(review, [
        [{ action: 'pull' }],
        [{ action: 'pull' }],
        [{ action: 'prune' }],
      ]),
    ).toEqual([
      ['Pick a directory.'],
      ['pull is not available here.'],
      ['prune is not available here.'],
    ])
    expect(
      checkResolveDecisions(review, [
        [{ action: 'pull', into: 'nope' }],
        [{ action: 'skip' }],
        [{ action: 'skip' }],
      ]),
    ).toEqual([['That directory is not in the config.'], [null], [null]])
  })

  it('accepts a pull into a configured directory', () => {
    expect(
      checkResolveDecisions(review, [
        [{ action: 'pull', into: 'locales/boost' }],
        [{ action: 'prune' }],
        [{ action: 'push' }],
      ]),
    ).toEqual([[null], [null], [null]])
  })
})

describe('resolveCommands', () => {
  it('merges keys that share an action and a locale set, pulls before pushes', () => {
    const review = doc([
      {
        index: 1,
        key: 'b',
        cells: [
          { ...cell('en', 'different'), needsInto: false },
          { ...cell('ja', 'different'), needsInto: false },
        ],
      },
      {
        index: 2,
        key: 'a',
        cells: [
          { ...cell('en', 'different'), needsInto: false },
          { ...cell('ja', 'conflict'), needsInto: false },
        ],
      },
      {
        index: 3,
        key: 'c',
        cells: [
          {
            ...cell('en', 'platform-added'),
            needsInto: true,
            allowed: ['pull', 'skip'],
          },
        ],
      },
      {
        index: 4,
        key: 'd',
        cells: [
          {
            ...cell('en', 'platform-deleted'),
            allowed: ['prune', 'push', 'skip'],
          },
        ],
      },
    ])
    const commands = resolveCommands(review, [
      [{ action: 'pull' }, { action: 'pull' }],
      [{ action: 'pull' }, { action: 'push' }],
      [{ action: 'pull', into: 'src/locales' }],
      [{ action: 'prune' }],
    ])
    expect(commands).toEqual([
      'localness pull --config app/localness.config.json --keys a --locales en',
      'localness pull --config app/localness.config.json --keys b --locales en,ja',
      'localness pull --config app/localness.config.json --keys c --locales en --into src/locales',
      'localness pull --config app/localness.config.json --keys d --locales en --prune',
      'localness push --config app/localness.config.json --keys a --locales ja --json',
    ])
  })

  it('leaves the config flag off when the review used the default config', () => {
    const review = doc([
      { index: 1, key: 'a', cells: [cell('en', 'different')] },
    ])
    review.config = ''
    expect(resolveCommands(review, [[{ action: 'skip' }]])).toEqual([])
    expect(resolveCommands(review, [[{ action: 'push' }]])).toEqual([
      'localness push --keys a --locales en --json',
    ])
  })

  it('quotes a config path that has a space', () => {
    const review = doc([
      { index: 1, key: 'a', cells: [cell('en', 'different')] },
    ])
    review.config = 'my app/localness.config.json'
    expect(resolveCommands(review, [[{ action: 'pull' }]])).toEqual([
      'localness pull --config "my app/localness.config.json" --keys a --locales en',
    ])
  })
})

describe('toResolveResult', () => {
  it('keeps every decision and cancels to nothing', () => {
    const review = doc([
      {
        index: 1,
        key: 'a',
        cells: [{ ...cell('en', 'different'), needsInto: true }],
      },
    ])
    const decisions = [[{ action: 'pull' as const, into: ' locales ' }]]
    expect(toResolveResult(review, 'approved', decisions)).toMatchObject({
      kind: 'resolve',
      status: 'approved',
      items: [{ key: 'a', locale: 'en', action: 'pull', into: 'locales' }],
    })
    expect(toResolveResult(review, 'cancelled', decisions)).toEqual({
      id: 'abcd1234',
      kind: 'resolve',
      status: 'cancelled',
      items: [],
      commands: [],
    })
  })
})

function cell(locale: string, kind: ResolveCell['kind']): ResolveCell {
  return {
    locale,
    kind,
    newer: 'local',
    local: 'L',
    platform: 'R',
    draft: 'R',
    base: null,
    locations: [],
    needsInto: false,
    allowed: ['pull', 'push', 'skip'],
  }
}
