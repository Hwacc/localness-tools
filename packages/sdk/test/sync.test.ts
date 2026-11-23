import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '../src'
import {
  CONFIG_FILE_NAME,
  applyPull,
  compareLocaleFiles,
  diffLocaleTexts,
  findConfigFile,
  loadConfig,
  parseConfig,
  PULL_KINDS,
  FORCED_PULL_KINDS,
  FORCED_PUSH_KINDS,
  PUSH_KINDS,
  applyPush,
  checkPlan,
  listPlans,
  planPull,
  describeBlocked,
  planPush,
  prunePlans,
  readBase,
  recordPull,
  resolveRelease,
  routeKey,
  savePlan,
  withConfigFields,
  writeBase,
  writeConfigFields,
  type LocalnessConfigInput,
} from '../src/sync'
import { BASE_URL, TOKEN, mockFetch } from './helpers'

type Texts = Record<string, { draftText?: string; publishedText?: string }>

function platform(
  keys: Record<string, Texts>,
  meta: Record<string, unknown> = {},
) {
  return mockFetch((call) => {
    if (call.url.pathname.endsWith('/meta')) {
      return {
        body: {
          project: { id: 1, name: 'Web' },
          locales: ['en', 'ja'],
          sourceLocale: 'en',
          localeFallback: 'en',
          release: null,
          releases: [],
          coverage: { keys: 0, projectKeys: 0, publishedPerLocale: {} },
          canManageReleases: false,
          generatedAt: 'now',
          ...meta,
        },
      }
    }
    const only = call.url.searchParams.get('keys')?.split(',')
    const entries = Object.entries(keys).filter(
      ([key]) => !only || only.includes(key),
    )
    return {
      body: {
        sourceLocale: 'en',
        keys: entries.map(([key, locales], id) => ({
          id,
          key,
          releaseIds: [],
          draft: false,
          locales: Object.fromEntries(
            Object.entries(locales).map(([locale, text]) => [
              locale,
              {
                draftText: text.draftText ?? null,
                publishedText: text.publishedText ?? null,
                state: 'published',
              },
            ]),
          ),
        })),
        total: entries.length,
        offset: 0,
        limit: 1000,
        generatedAt: 'now',
      },
    }
  })
}

describe('diffLocaleTexts', () => {
  it('tells who changed by the base', () => {
    const entries = diffLocaleTexts({
      locales: ['en'],
      local: {
        en: {
          same: 'A',
          theirs: 'base',
          mine: 'new',
          both: 'mine',
          nobase: 'L',
          added: 'L',
          dropped: 'L',
          waiting: 'pushed',
          busy: 'mine',
        },
      },
      platform: {
        texts: {
          en: {
            same: 'A',
            theirs: 'moved',
            mine: 'base',
            both: 'theirs',
            nobase: 'P',
            remote: 'R',
            gone: 'base',
            waiting: 'old',
            busy: 'base',
          },
        },
        drafts: {
          en: { waiting: 'pushed', busy: 'someone', mine: 'base' },
        },
      },
      base: {
        en: {
          theirs: 'base',
          mine: 'base',
          both: 'base',
          dropped: 'L',
          gone: 'base',
          busy: 'base',
        },
      },
    })
    expect(
      Object.fromEntries(entries.map((entry) => [entry.key, entry.kind])),
    ).toEqual({
      added: 'local-added',
      both: 'conflict',
      busy: 'conflict',
      dropped: 'platform-deleted',
      gone: 'local-deleted',
      mine: 'local-changed',
      nobase: 'different',
      remote: 'platform-added',
      theirs: 'platform-changed',
      waiting: 'pending-publish',
    })
  })

  it('reports an empty value only when the file and remote both have no text', () => {
    const place = (dir: string, value: string) => ({
      dir,
      relativePath: `${dir}/en.json`,
      value,
      path: [value],
    })
    const entries = diffLocaleTexts({
      locales: ['en'],
      local: { en: { kept: 'Hello' } },
      platform: {
        texts: {
          en: { absent: null, blank: null, kept: null, remote: 'Hello' },
        },
        drafts: { en: {} },
      },
      base: null,
      placement: {
        dirs: { split: ['a', 'b'] },
        locations: {
          en: { split: [place('a', 'one'), place('b', 'two')] },
        },
        empties: {
          en: ['blank', 'kept', 'onlyLocal', 'remote', 'split'],
        },
      },
    })
    expect(
      Object.fromEntries(entries.map((entry) => [entry.key, entry.kind])),
    ).toEqual({
      blank: 'empty',
      kept: 'local-added',
      onlyLocal: 'empty',
      remote: 'platform-added',
      split: 'duplicate',
    })
  })
})

describe('locale file sync', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'localness-sync-'))
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  async function setup(config: Partial<LocalnessConfigInput> = {}) {
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({
        baseUrl: BASE_URL,
        files: { dir: 'locales' },
        ...config,
      }),
    )
    await mkdir(join(root, 'locales'), { recursive: true })
    return loadConfig(join(root, CONFIG_FILE_NAME))
  }

  it('finds the nearest config above a directory', async () => {
    await setup()
    const nested = join(root, 'src', 'deep')
    await mkdir(nested, { recursive: true })
    expect(await findConfigFile(nested)).toBe(join(root, CONFIG_FILE_NAME))
  })

  it('rejects an invalid files section', () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ baseUrl: BASE_URL, files: { dir: '../x' } }),
      ),
    ).toThrow(/relative path/)
  })

  it('pulls platform text into the files, keeping local-only keys', async () => {
    const loaded = await setup()
    await writeFile(
      join(root, 'locales', 'en.json'),
      '{\n    "home": {\n        "title": "Old"\n    },\n    "mine": "Keep"\n}\n',
    )
    const { fetch } = platform({
      'home.title': {
        en: { publishedText: 'Home' },
        ja: { publishedText: 'ホーム' },
      },
      'home.cta': { en: { publishedText: 'Go', draftText: 'Go now' } },
      __unnamed_abc: { en: { publishedText: 'Ignored' } },
    })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const comparison = await compareLocaleFiles(loaded, client)
    const plan = planPull(comparison, { kinds: PULL_KINDS })
    expect(
      plan.files.map((file) => [file.relativePath, file.created, file.set]),
    ).toEqual([
      ['locales/en.json', false, ['home.cta', 'home.title']],
      ['locales/ja.json', true, ['home.title']],
    ])
    await applyPull(plan.files)
    expect(await readFile(join(root, 'locales', 'en.json'), 'utf8')).toBe(
      '{\n    "home": {\n        "title": "Home",\n        "cta": "Go"\n    },\n    "mine": "Keep"\n}\n',
    )
    expect(
      JSON.parse(await readFile(join(root, 'locales', 'ja.json'), 'utf8')),
    ).toEqual({ home: { title: 'ホーム' } })
  })

  it('prunes, skips colliding keys, and reads drafts when asked', async () => {
    const loaded = await setup({ content: 'draft', locales: ['en'] })
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ gone: 'x', a: 'text' }),
    )
    const { fetch } = platform({
      'a.b': { en: { publishedText: 'blocked' } },
      cta: { en: { publishedText: 'Go', draftText: 'Go now' } },
    })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const {
      files: [file],
    } = planPull(await compareLocaleFiles(loaded, client), {
      kinds: PULL_KINDS,
      prune: true,
    })
    expect(file).toMatchObject({
      set: ['cta'],
      removed: ['a', 'gone'],
      skipped: ['a.b'],
    })
    expect(JSON.parse(file!.output!)).toEqual({ cta: 'Go now' })
  })

  it('updates array elements in place, never adds or removes them', async () => {
    const loaded = await setup({ locales: ['en'] })
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ list: [{ title: 'Old' }, { title: 'Gone' }] }),
    )
    const { fetch } = platform({
      'list.0.title': { en: { publishedText: 'New' } },
      'list.2.title': { en: { publishedText: 'Past the end' } },
    })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const comparison = await compareLocaleFiles(loaded, client)
    const withBase = { ...comparison, base: { en: { 'list.1.title': 'Gone' } } }
    expect(
      withBase.entries.find((entry) => entry.key === 'list.1.title')
        ?.onPlatform,
    ).toBe(false)
    const plan = planPull(withBase, { kinds: PULL_KINDS, prune: true })
    expect(plan.files[0]).toMatchObject({
      set: ['list.0.title'],
      removed: [],
      keptInArray: ['list.1.title'],
      skipped: ['list.2.title'],
    })
    expect(JSON.parse(plan.files[0]!.output!)).toEqual({
      list: [{ title: 'New' }, { title: 'Gone' }],
    })
    expect(recordPull(withBase, plan.files).en).toEqual({
      'list.0.title': 'New',
      'list.1.title': 'Gone',
    })
  })

  it("blocks new keys whose name breaks the project's convention", async () => {
    const loaded = await setup()
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({
        old: 'Old!',
        web: { ok: 'Ok', Shipping_address: 'Ship' },
        Bad: 'Bad',
      }),
    )
    await writeFile(
      join(root, 'locales', 'ja.json'),
      JSON.stringify({ Bad: 'B' }),
    )
    const client = createClient({
      baseUrl: BASE_URL,
      token: TOKEN,
      fetch: platform({ old: { en: { publishedText: 'Old' } } }).fetch,
    })
    const comparison = await compareLocaleFiles(loaded, client)
    comparison.platform.keyConvention = {
      prefix: 'web',
      separator: '.',
      style: 'snake_case',
      maxDepth: 4,
      guidance: null,
    }
    const plan = planPush(loaded, comparison, { kinds: FORCED_PUSH_KINDS })
    expect(plan.keys.map((item) => [item.key, Boolean(item.create)])).toEqual([
      ['old', false],
      ['web.Shipping_address', true],
      ['web.ok', true],
    ])
    expect(plan.blocked).toEqual([
      {
        locale: 'en',
        key: 'Bad',
        reason: 'key-name',
        violations: ['prefix'],
      },
    ])
    expect(plan.warnings).toEqual([
      { key: 'web.Shipping_address', violations: ['case'] },
    ])
    expect(describeBlocked(plan.blocked[0]!, 'en')).toMatch(/key convention/)
  })

  it('records a base, then plans pushes for local changes only', async () => {
    const loaded = await setup()
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ a: 'A', b: 'B' }),
    )
    const keys: Record<string, Texts> = {
      a: { en: { publishedText: 'A', draftText: 'A' } },
      b: { en: { publishedText: 'B', draftText: 'B' } },
    }
    const client = createClient({
      baseUrl: BASE_URL,
      token: TOKEN,
      fetch: platform(keys).fetch,
    })
    const first = await compareLocaleFiles(loaded, client)
    expect(first.base).toBeNull()
    await writeBase(loaded, recordPull(first, []))
    expect(await readBase(loaded)).toEqual({ en: { a: 'A', b: 'B' } })
    expect(await readFile(join(root, '.localness', '.gitignore'), 'utf8')).toBe(
      '*\n',
    )

    keys.a = { en: { publishedText: 'A2', draftText: 'A2' } }
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ a: 'A', b: 'B2', c: 'C' }),
    )
    await writeFile(
      join(root, 'locales', 'ja.json'),
      JSON.stringify({ d: 'D' }),
    )
    const second = await compareLocaleFiles(loaded, client)
    expect(second.entries.map((entry) => [entry.key, entry.kind])).toEqual([
      ['a', 'platform-changed'],
      ['b', 'local-changed'],
      ['c', 'local-added'],
      ['d', 'local-added'],
    ])
    const plan = planPush(loaded, second, { kinds: PUSH_KINDS })
    expect(plan.keys).toEqual([
      {
        key: 'b',
        create: null,
        locales: { en: { text: 'B2', platform: 'B', draft: 'B' } },
      },
      { key: 'c', create: { sourceText: 'C' }, locales: {} },
    ])
    expect(plan.blocked).toEqual([
      { locale: 'ja', key: 'd', reason: 'no-source-text' },
    ])

    expect((await checkPlan(client, plan)).stale).toEqual([])
    keys.b = { en: { publishedText: 'B', draftText: 'Someone' } }
    keys.c = { en: { publishedText: 'C' } }
    expect((await checkPlan(client, plan)).stale).toEqual(['b', 'c'])
    expect(
      (await checkPlan(client, plan, new Date(Date.now() + 2 * 3600_000)))
        .expired,
    ).toBe(true)

    await savePlan(loaded, plan)
    await writeFile(join(root, '.localness', 'plans', 'broken.json'), '{')
    expect(await prunePlans(loaded)).toEqual([])
    expect(
      await prunePlans(loaded, new Date(Date.now() + 2 * 3600_000)),
    ).toEqual([plan.id])
    expect(await listPlans(loaded)).toEqual([])
    expect(
      await readFile(join(root, '.localness', 'plans', 'broken.json'), 'utf8'),
    ).toBe('{')
  })

  it('limits both sides to the requested keys', async () => {
    const loaded = await setup({ locales: ['en'] })
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ a: 'x', other: 'y' }),
    )
    const { fetch, calls } = platform({ a: { en: { publishedText: 'A' } } })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const comparison = await compareLocaleFiles(loaded, client, { keys: ['a'] })
    expect(comparison.entries.map((entry) => entry.key)).toEqual(['a'])
    expect(calls.at(-1)!.url.searchParams.get('keys')).toBe('a')
  })

  it('reports an empty value, and pulls remote text over one', async () => {
    const loaded = await setup({ locales: ['en'] })
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ blank: '', other: '   ', title: '', real: 'Mine' }),
    )
    const { fetch } = platform({
      title: { en: { publishedText: 'Hello' } },
      missing: { en: { publishedText: '' } },
    })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const comparison = await compareLocaleFiles(loaded, client)
    expect(
      comparison.entries.map((entry) => [entry.key, entry.kind, entry.local]),
    ).toEqual([
      ['blank', 'empty', null],
      ['other', 'empty', null],
      ['real', 'local-added', 'Mine'],
      ['title', 'platform-added', null],
    ])
    expect(comparison.placement.empties.en).toEqual(['blank', 'other', 'title'])
    expect(comparison.entries.some((entry) => entry.key === 'missing')).toBe(
      false,
    )
    const pulled = planPull(comparison, {
      kinds: FORCED_PULL_KINDS,
      prune: true,
    })
    expect(pulled.files.map((file) => [file.set, file.removed])).toEqual([
      [['title'], ['real']],
    ])
    expect(
      planPush(loaded, comparison, { kinds: FORCED_PUSH_KINDS }).keys.map(
        (item) => item.key,
      ),
    ).toEqual(['real'])
  })

  it('limits empty keys to the requested names', async () => {
    const loaded = await setup({ locales: ['en'] })
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ blank: '', other: '' }),
    )
    const { fetch } = platform({})
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const comparison = await compareLocaleFiles(loaded, client, {
      keys: ['blank'],
    })
    expect(comparison.entries.map((entry) => [entry.key, entry.kind])).toEqual([
      ['blank', 'empty'],
    ])
    expect(comparison.placement.empties.en).toEqual(['blank'])
  })

  it('keeps a real text in another directory ahead of an empty one', async () => {
    const loaded = await setup({
      files: [{ dir: 'a' }, { dir: 'b' }],
      locales: ['en'],
    })
    await mkdir(join(root, 'a'), { recursive: true })
    await mkdir(join(root, 'b'), { recursive: true })
    await writeFile(
      join(root, 'a', 'en.json'),
      JSON.stringify({ title: '', blank: '', split: 'one' }),
    )
    await writeFile(
      join(root, 'b', 'en.json'),
      JSON.stringify({ title: 'Hello', blank: '', split: 'two' }),
    )
    const { fetch } = platform({})
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const comparison = await compareLocaleFiles(loaded, client)
    expect(
      comparison.entries.map((entry) => [entry.key, entry.kind, entry.local]),
    ).toEqual([
      ['blank', 'empty', null],
      ['split', 'duplicate', null],
      ['title', 'local-added', 'Hello'],
    ])
    expect(comparison.placement.empties.en).toEqual(['blank', 'title'])
  })

  it('warns about files that are not a project locale', async () => {
    const loaded = await setup({
      files: [
        { dir: 'gogreen' },
        { dir: 'lwi' },
        { dir: 'onboard' },
        { dir: 'nested', pattern: '{locale}/messages.json' },
        { dir: 'absent' },
      ],
    })
    const put = async (path: string, text: string) => {
      await mkdir(join(root, ...path.split('/').slice(0, -1)), {
        recursive: true,
      })
      await writeFile(join(root, ...path.split('/')), text)
    }
    await put('gogreen/en.json', '{}')
    await put('gogreen/zh-CN.json', '{}')
    await put('gogreen/zh-TW.json', '{}')
    await put('gogreen/zh.json', JSON.stringify({ title: '标题' }))
    await put('gogreen/.DS_Store', '')
    await put('gogreen/notes.txt', 'nope')
    await put('lwi/en.json', '{}')
    await put('lwi/it.json', JSON.stringify({ a: 'A' }))
    await put('onboard/zh.json', '')
    await put('nested/en/messages.json', '{}')
    await put('nested/en/other.json', JSON.stringify({ a: 'nope' }))
    await put('nested/fr/messages.json', JSON.stringify({ a: 'A' }))
    const { fetch } = platform({}, { locales: ['en', 'zh_cn', 'zh_tw'] })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const comparison = await compareLocaleFiles(loaded, client)
    const has = 'en, zh_cn, zh_tw'
    expect(comparison.warnings).toEqual([
      `gogreen/zh.json is not a project locale; "zh" looks like zh_cn, zh_tw, so check localeMap (the project has: ${has}).`,
      `lwi/it.json is not a project locale (the project has: ${has}).`,
      `onboard/zh.json is not a project locale; "zh" looks like zh_cn, zh_tw, so check localeMap (the project has: ${has}). It cannot be parsed: Invalid JSON (ValueExpected).`,
      `nested/fr/messages.json is not a project locale (the project has: ${has}).`,
    ])
    expect(comparison.entries).toEqual([])
    const paths = comparison.files.map((file) => file.relativePath)
    expect(paths).toContain('gogreen/zh-CN.json')
    expect(paths).toContain('nested/en/messages.json')
    expect(paths).not.toContain('gogreen/zh.json')
    expect(paths).not.toContain('lwi/it.json')
    expect(paths).not.toContain('onboard/zh.json')
    expect(paths).not.toContain('nested/fr/messages.json')
  })

  it('does not warn when localeMap names the file', async () => {
    const loaded = await setup({
      files: { dir: 'gogreen' },
      localeMap: { zh_cn: 'zh' },
    })
    await mkdir(join(root, 'gogreen'), { recursive: true })
    await writeFile(join(root, 'gogreen', 'zh.json'), '{}')
    await writeFile(join(root, 'gogreen', 'en.json'), '{}')
    await writeFile(join(root, 'gogreen', 'zh-CN.json'), '{}')
    const { fetch } = platform({}, { locales: ['en', 'zh_cn'] })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const comparison = await compareLocaleFiles(loaded, client)
    expect(comparison.warnings).toEqual([
      'gogreen/zh-CN.json is not a project locale; "zh-CN" looks like zh_cn, so check localeMap (the project has: en, zh_cn).',
    ])
  })

  it('labels created keys with the config release', async () => {
    const loaded = await setup({ release: 'V2' })
    await writeFile(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ c: 'C' }),
    )
    const { fetch, calls } = mockFetch((call) => {
      if (call.url.pathname.endsWith('/meta')) {
        return {
          body: {
            project: { id: 1, name: 'Web' },
            locales: ['en'],
            sourceLocale: 'en',
            localeFallback: 'en',
            release: null,
            releases: [{ id: '7', name: 'v2', sort: 1 }],
            coverage: { keys: 0, projectKeys: 0, publishedPerLocale: {} },
            canManageReleases: false,
            generatedAt: 'now',
          },
        }
      }
      if (call.method === 'POST') {
        return { body: { sourceLocale: 'en', created: true, key: {} } }
      }
      return {
        body: {
          sourceLocale: 'en',
          keys: [],
          total: 0,
          offset: 0,
          limit: 1000,
          generatedAt: 'now',
        },
      }
    })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const release = await resolveRelease(loaded, client)
    expect(release).toEqual({ id: 7, name: 'v2' })
    const plan = planPush(
      loaded,
      { ...(await compareLocaleFiles(loaded, client)) },
      { kinds: PUSH_KINDS, release },
    )
    await applyPush(client, plan, await checkPlan(client, plan))
    expect(calls.find((call) => call.method === 'POST')!.body).toEqual({
      key: 'c',
      sourceText: 'C',
      releaseId: 7,
    })

    const unknown = await setup({ release: 'v9' })
    await expect(resolveRelease(unknown, client)).rejects.toThrow(
      /no release "v9"/,
    )
  })

  it('rewrites config fields, dropping undefined ones', async () => {
    expect(
      withConfigFields('{"baseUrl":"x","release":"v1","a":1}', {
        release: undefined,
        project: 'web',
      }),
    ).toBe('{\n  "baseUrl": "x",\n  "a": 1,\n  "project": "web"\n}\n')
    const path = join(root, CONFIG_FILE_NAME)
    await writeConfigFields(path, { release: 'v2' })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ release: 'v2' })
  })

  it('rejects a locale the project lacks', async () => {
    const loaded = await setup({ locales: ['fr'] })
    const { fetch } = platform({})
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    await expect(compareLocaleFiles(loaded, client)).rejects.toThrow(
      /Unknown locale fr/,
    )
  })

  describe('several directories', () => {
    const files = [
      { dir: 'default' },
      { dir: 'boostprime', match: { namespace: 'boostprime' } },
    ]
    const meta = {
      namespaces: [{ id: '1', name: 'boostprime', sort: 1 }],
      keyConvention: {
        prefix: '',
        separator: '_',
        style: 'snake_case',
        maxDepth: 4,
        guidance: null,
      },
    }

    async function write(path: string, content: unknown) {
      await mkdir(join(root, ...path.split('/').slice(0, -1)), {
        recursive: true,
      })
      await writeFile(join(root, ...path.split('/')), JSON.stringify(content))
    }

    const read = async (path: string) =>
      JSON.parse(await readFile(join(root, ...path.split('/')), 'utf8'))

    async function compare(
      loaded: Awaited<ReturnType<typeof setup>>,
      keys: Record<string, Texts>,
      options: { locales?: string[]; projectLocales?: string[] } = {},
    ) {
      const client = createClient({
        baseUrl: BASE_URL,
        token: TOKEN,
        fetch: platform(keys, {
          ...meta,
          ...(options.projectLocales && { locales: options.projectLocales }),
        }).fetch,
      })
      return {
        client,
        comparison: await compareLocaleFiles(loaded, client, {
          locales: options.locales,
        }),
      }
    }

    it('keeps a key in the directory holding it in a locale that was not requested', async () => {
      const loaded = await setup({
        files: [
          { dir: 'default' },
          { dir: 'boostprime', match: { key: '^zzz' } },
        ],
        locales: ['en', 'ja'],
      })
      await write('default/en.json', { a: 'A' })
      await write('boostprime/en.json', { boostprime_x: 'X' })
      const { comparison } = await compare(
        loaded,
        {
          boostprime_x: {
            en: { publishedText: 'X' },
            ja: { publishedText: 'ja' },
          },
        },
        { locales: ['ja'] },
      )
      const [entry] = comparison.entries
      expect(entry).toMatchObject({ locale: 'ja', kind: 'platform-added' })
      expect(entry!.target).toEqual({ dir: 'boostprime', by: 'existing' })
      expect(comparison.files.every((file) => file.locale === 'ja')).toBe(true)
      const plan = planPull(comparison, { kinds: PULL_KINDS })
      await applyPull(plan.files)
      expect(await read('boostprime/ja.json')).toEqual({ boostprime_x: 'ja' })
      await expect(read('default/ja.json')).rejects.toThrow()
    })

    it('detects a duplicate across locales that were not requested', async () => {
      const loaded = await setup({ files, locales: ['en', 'ja'] })
      await write('default/en.json', { shared: 'S' })
      await write('boostprime/zh-CN.json', { shared: 'S-zh' })
      const { comparison } = await compare(
        loaded,
        { shared: { ja: { publishedText: 'S-ja' } } },
        { locales: ['ja'], projectLocales: ['en', 'ja', 'zh-CN'] },
      )
      expect(
        comparison.entries.map((entry) => [
          entry.locale,
          entry.key,
          entry.kind,
        ]),
      ).toEqual([['ja', 'shared', 'duplicate']])
    })

    it('accepts an object or a list and checks every entry', () => {
      const parse = (files: unknown) =>
        parseConfig(JSON.stringify({ baseUrl: BASE_URL, files }))
      expect(parse({ dir: 'a' }).files).toEqual([
        { dir: 'a', pattern: '{locale}.json', format: 'nested-json' },
      ])
      expect(parse(files).files).toHaveLength(2)
      expect(() => parse([{ dir: 'a' }, { dir: 'a' }])).toThrow(/listed twice/)
      expect(() => parse([{ dir: 'a', match: { key: '(' } }])).toThrow(
        /regular expression/,
      )
      expect(() => parse([{ dir: 'a', match: {} }])).toThrow(/needs/)
      expect(() => parse([{ dir: 'a' }, { dir: '/abs' }])).toThrow()
    })

    it('routes a key to its directory, a match, the fallback, or nowhere', () => {
      const all = parseConfig(
        JSON.stringify({
          baseUrl: BASE_URL,
          files: [
            { dir: 'a', match: { key: '^x_' } },
            { dir: 'b', match: { namespace: 'boostprime', key: '_new$' } },
            { dir: 'c', match: { namespace: 'boostprime' } },
            { dir: 'd' },
          ],
        }),
      ).files!
      const context = { namespaces: ['boostprime'], keyPrefix: '' }
      const route = (key: string, existing?: string[]) =>
        routeKey(key, all, { ...context, existing })
      expect(route('x_one')).toEqual({ dir: 'a', by: 'key' })
      expect(route('boostprime_new')).toEqual({ dir: 'b', by: 'namespace' })
      expect(route('boostprime_old')).toEqual({ dir: 'c', by: 'namespace' })
      expect(route('other')).toEqual({ dir: 'd', by: 'fallback' })
      expect(route('x_one', ['d'])).toEqual({ dir: 'd', by: 'existing' })
      expect(routeKey('other', all.slice(0, 3), context)).toEqual({
        dir: null,
        by: 'unrouted',
      })
    })

    it('pulls each key into its directory, writing every location of a duplicate', async () => {
      const loaded = await setup({ files, locales: ['en', 'ja'] })
      await write('default/en.json', { a: 'A', shared: 'S' })
      await write('boostprime/en.json', { boostprime_x: 'X', shared: 'S' })
      const { comparison } = await compare(loaded, {
        a: { en: { publishedText: 'A' } },
        shared: { en: { publishedText: 'S2' }, ja: { publishedText: 'S-ja' } },
        boostprime_x: { en: { publishedText: 'X' } },
        boostprime_new: { en: { publishedText: 'N' } },
        plain_new: { en: { publishedText: 'P' } },
      })
      expect(
        comparison.entries.map((entry) => [entry.key, entry.kind]),
      ).toEqual([
        ['boostprime_new', 'platform-added'],
        ['plain_new', 'platform-added'],
        ['shared', 'different'],
        ['shared', 'duplicate'],
      ])
      expect(
        comparison.entries.find((entry) => entry.key === 'boostprime_new')!
          .target,
      ).toEqual({ dir: 'boostprime', by: 'namespace' })
      const plan = planPull(comparison, { kinds: PULL_KINDS })
      expect(plan.duplicates.map((entry) => entry.locale)).toEqual(['ja'])
      expect(plan.files.map((file) => [file.relativePath, file.set])).toEqual([
        ['default/en.json', ['plain_new', 'shared']],
        ['boostprime/en.json', ['boostprime_new', 'shared']],
      ])
      await applyPull(plan.files)
      expect(await read('boostprime/en.json')).toEqual({
        boostprime_x: 'X',
        shared: 'S2',
        boostprime_new: 'N',
      })
      expect(await read('default/en.json')).toEqual({
        a: 'A',
        shared: 'S2',
        plain_new: 'P',
      })
    })

    it('holds back keys that differ between directories, and a new locale of a duplicate', async () => {
      const loaded = await setup({ files, locales: ['en', 'ja'] })
      await write('default/en.json', { diff: 'one', same: 'S' })
      await write('boostprime/en.json', { diff: 'two', same: 'S' })
      const { comparison } = await compare(loaded, {
        diff: { en: { publishedText: 'one' } },
        same: { en: { publishedText: 'S' }, ja: { publishedText: 'ja' } },
      })
      const entries = comparison.entries.map((entry) => [
        entry.locale,
        entry.key,
        entry.kind,
        entry.local,
        entry.locations.map((place) => place.value),
      ])
      expect(entries).toEqual([
        ['en', 'diff', 'duplicate', null, ['one', 'two']],
        ['ja', 'same', 'duplicate', null, []],
      ])
      expect(comparison.local.en).toEqual({ same: 'S' })

      const plan = planPull(comparison, { kinds: PULL_KINDS })
      expect(plan.files).toEqual([])
      expect(plan.duplicates).toHaveLength(2)
      const forced = planPull(comparison, { kinds: FORCED_PULL_KINDS })
      expect(forced.files.map((file) => [file.relativePath, file.set])).toEqual(
        [
          ['default/en.json', ['diff']],
          ['boostprime/en.json', ['diff']],
        ],
      )
      expect(forced.duplicates.map((entry) => entry.locale)).toEqual(['ja'])
      const placed = planPull(comparison, {
        kinds: FORCED_PULL_KINDS,
        into: 'boostprime/',
      })
      expect(placed.duplicates).toEqual([])
      expect(
        placed.files.find((file) => file.relativePath === 'boostprime/ja.json'),
      ).toMatchObject({ created: true, set: ['same'] })
      expect(() =>
        planPull(comparison, { kinds: FORCED_PULL_KINDS, into: 'nowhere' }),
      ).toThrow(/not a configured directory/)

      const pushPlan = planPush(loaded, comparison, {
        kinds: FORCED_PUSH_KINDS,
      })
      expect(pushPlan.keys).toEqual([])
      expect(pushPlan.blocked).toEqual([
        { locale: 'en', key: 'diff', reason: 'duplicate' },
      ])
    })

    it('leaves unrouted keys for a person and writes them with --into', async () => {
      const loaded = await setup({
        files: [{ dir: 'default', match: { key: '^a' } }, files[1]!],
        locales: ['en'],
      })
      await write('default/en.json', {})
      const { comparison } = await compare(loaded, {
        zzz: { en: { publishedText: 'Z' } },
        abc: { en: { publishedText: 'A' } },
      })
      const plan = planPull(comparison, { kinds: PULL_KINDS })
      expect(plan.unrouted.map((entry) => entry.key)).toEqual(['zzz'])
      expect(plan.files.map((file) => [file.relativePath, file.set])).toEqual([
        ['default/en.json', ['abc']],
      ])
      const into = planPull(comparison, {
        kinds: PULL_KINDS,
        into: 'boostprime',
      })
      expect(into.unrouted).toEqual([])
      expect(into.files.map((file) => [file.relativePath, file.set])).toEqual([
        ['default/en.json', ['abc']],
        ['boostprime/en.json', ['zzz']],
      ])
    })

    it('writes each directory in its own format, prunes everywhere, and records the base', async () => {
      const loaded = await setup({
        files: [
          { dir: 'default' },
          { dir: 'flat', format: 'flat-json', match: { key: '^flat' } },
        ],
        locales: ['en'],
      })
      await write('default/en.json', { gone: 'x', held: 'one' })
      await write('flat/en.json', { gone: 'x', held: 'two' })
      const { comparison } = await compare(loaded, {
        'flat.a': { en: { publishedText: 'F' } },
        'nest.b': { en: { publishedText: 'N' } },
        held: { en: { publishedText: 'H' } },
      })
      const plan = planPull(comparison, {
        kinds: FORCED_PULL_KINDS,
        prune: true,
      })
      await applyPull(plan.files)
      expect(await read('flat/en.json')).toEqual({
        'flat.a': 'F',
        held: 'H',
      })
      expect(await read('default/en.json')).toEqual({
        nest: { b: 'N' },
        held: 'H',
      })
      expect(recordPull(comparison, plan.files).en).toEqual({
        'flat.a': 'F',
        'nest.b': 'N',
        held: 'H',
      })
    })

    it('keeps the base of keys a pull skipped', async () => {
      const loaded = await setup({ files, locales: ['en'] })
      await write('default/en.json', { diff: 'one' })
      await write('boostprime/en.json', { diff: 'two' })
      const { comparison } = await compare(loaded, {
        diff: { en: { publishedText: 'P' } },
        fresh: { en: { publishedText: 'F' } },
      })
      const noHome = { ...comparison, base: { en: { diff: 'old' } } }
      const plan = planPull(noHome, { kinds: PULL_KINDS })
      expect(recordPull(noHome, plan.files).en).toEqual({
        diff: 'old',
        fresh: 'F',
      })
    })
  })
})
