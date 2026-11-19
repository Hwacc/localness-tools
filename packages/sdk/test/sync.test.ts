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
  savePlan,
  withConfigFields,
  writeBase,
  writeConfigFields,
  type LocalnessConfigInput,
} from '../src/sync'
import { BASE_URL, TOKEN, mockFetch } from './helpers'

type Texts = Record<string, { draftText?: string; publishedText?: string }>

function platform(keys: Record<string, Texts>) {
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
    const plan = planPull(comparison, {
      format: 'nested-json',
      kinds: PULL_KINDS,
    })
    expect(
      plan.map((file) => [file.relativePath, file.created, file.set]),
    ).toEqual([
      ['locales/en.json', false, ['home.cta', 'home.title']],
      ['locales/ja.json', true, ['home.title']],
    ])
    await applyPull(plan)
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
    const [file] = planPull(await compareLocaleFiles(loaded, client), {
      format: 'nested-json',
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
})
