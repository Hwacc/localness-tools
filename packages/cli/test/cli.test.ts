import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FetchLike } from '@localness/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupLocaleFiles, matchLocales } from '../src/init'
import { parseEnvFile } from '../src/env'
import { run } from '../src/run'
import { clientOf } from '../src/shared'
import { GLOBAL_SKILLS, skillDirsFor } from '../src/skill'

const BASE_URL = 'https://localness.example.com'

type Texts = Record<
  string,
  { draftText: string | null; publishedText: string | null }
>

/**
 * The project: `en` and `zh_cn`. Pass published text per key; the returned
 * `keys` is the live state, so tests can edit it and see writes land.
 */
function project(
  initial: Record<string, Record<string, string>> = {},
  meta: Record<string, unknown> = {},
) {
  const keys: Record<string, Texts> = {}
  for (const [key, texts] of Object.entries(initial)) {
    keys[key] = {}
    for (const [locale, text] of Object.entries(texts)) {
      keys[key][locale] = { draftText: text, publishedText: text }
    }
  }
  const writes: { method: string; body: unknown; client?: string }[] = []
  const releases = [{ id: 3, name: 'v2', sort: 1 }]
  const labels: Record<string, number[]> = {}
  const idOf = (key: string) => Object.keys(keys).indexOf(key) + 1
  const state = (key: string) => ({
    id: idOf(key),
    key,
    releaseIds: labels[key] ?? [],
    draft: false,
    locales: Object.fromEntries(
      Object.entries(keys[key] ?? {}).map(([locale, text]) => [
        locale,
        { ...text, state: 'published' },
      ]),
    ),
  })
  const reply = (body: unknown, status = 200) => ({
    ok: status < 300,
    status,
    json: async () => body,
  })
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    if (url.pathname.endsWith('/meta')) {
      return reply({
        project: { id: 1, name: 'Web' },
        locales: ['en', 'zh_cn'],
        sourceLocale: 'en',
        localeFallback: 'en',
        release: null,
        releases,
        coverage: { keys: 0, projectKeys: 0, publishedPerLocale: {} },
        canManageReleases: false,
        generatedAt: 'now',
        ...meta,
      })
    }
    if (url.pathname.endsWith('/match')) {
      const { texts } = JSON.parse(init!.body!) as { texts: string[] }
      return reply({
        matches: texts.map((text) => ({
          text,
          keys: Object.keys(keys)
            .filter((key) => keys[key]!.en?.draftText === text)
            .map((key) => ({
              id: idOf(key),
              key,
              sourceText: text,
              draft: false,
              releaseIds: [],
            })),
        })),
      })
    }
    if (method !== 'GET') {
      const body = JSON.parse(init!.body!) as {
        key: string
        sourceText?: string
        releaseId?: number
        locales?: Record<string, { text: string; expected: string }>
      }
      writes.push({
        method,
        body,
        client: init?.headers?.['x-localness-client'],
      })
      if (url.pathname.endsWith('/releases')) {
        const created = {
          id: 9,
          name: (body as unknown as { name: string }).name,
          sort: 2,
        }
        releases.push(created)
        return reply(created)
      }
      if (url.pathname.endsWith('/release-membership')) {
        const { releaseId, ids, mode } = body as unknown as {
          releaseId: number
          ids: number[]
          mode: string
        }
        for (const key of Object.keys(keys)) {
          if (!ids.includes(idOf(key))) continue
          const own = (labels[key] ?? []).filter((id) => id !== releaseId)
          labels[key] = mode === 'add' ? [...own, releaseId] : own
        }
        return reply({ ok: true, changed: ids.length })
      }
      if (method === 'POST') {
        keys[body.key] = {
          en: { draftText: body.sourceText!, publishedText: body.sourceText! },
        }
        if (body.releaseId) labels[body.key] = [body.releaseId]
      } else {
        for (const [locale, edit] of Object.entries(body.locales!)) {
          const current = keys[body.key]![locale]
          if ((current?.draftText ?? '') !== edit.expected) {
            return reply({ message: 'stale' }, 409)
          }
          keys[body.key]![locale] = {
            draftText: edit.text,
            publishedText: current?.publishedText ?? null,
          }
        }
      }
      return reply({
        sourceLocale: 'en',
        created: method === 'POST',
        key: state(body.key),
      })
    }
    const only = url.searchParams.get('keys')?.split(',')
    const names = Object.keys(keys).filter((key) => !only || only.includes(key))
    return reply({
      sourceLocale: 'en',
      keys: names.map(state),
      total: names.length,
      offset: 0,
      limit: 1000,
      generatedAt: 'now',
    })
  }
  return { fetch, keys, writes, labels }
}

function platform(
  keys: Record<string, Record<string, string>>,
  meta: Record<string, unknown> = {},
): FetchLike {
  return project(keys, meta).fetch
}

describe('init detection', () => {
  it('prefers the layout with the most locales', () => {
    const groups = groupLocaleFiles([
      'package.json',
      'src/locales/en.json',
      'src/locales/zh-CN.json',
      'src/locales/ja.json',
      'public/i18n/en/common.json',
      'public/i18n/de/common.json',
      'src/app.json',
    ])
    expect(
      groups.map((group) => [group.dir, group.pattern, group.files.size]),
    ).toEqual([
      ['src/locales', '{locale}.json', 3],
      ['public/i18n', '{locale}/common.json', 2],
    ])
  })

  it('maps file names that differ from the default naming', () => {
    expect(matchLocales(['en', 'zh_cn', 'ja'], ['en', 'zh-cn', 'fr'])).toEqual({
      localeMap: { zh_cn: 'zh-cn' },
      withoutFile: ['ja'],
      unmatched: ['fr'],
    })
  })
})

describe('commands', () => {
  let root: string
  const out: string[] = []
  const err: string[] = []

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'localness-cli-'))
    out.length = 0
    err.length = 0
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  async function put(path: string, text: string) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), text)
  }

  function cli(args: string[], fetch: FetchLike, token = 'lnk_test') {
    return run(args, {
      cwd: root,
      env: { LOCALNESS_TOKEN: token },
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      fetch,
      home: join(root, 'home'),
    })
  }

  it('init writes a config matched against the project', async () => {
    await put('src/locales/en.json', '{ "home": { "title": "Home" } }')
    await put('src/locales/zh-cn.json', '{}')
    const code = await cli(['init', '--base-url', BASE_URL], platform({}))
    expect(code).toBe(0)
    expect(
      JSON.parse(await readFile(join(root, 'localness.config.json'), 'utf8')),
    ).toEqual({
      baseUrl: BASE_URL,
      project: 'Web',
      files: {
        dir: 'src/locales',
        pattern: '{locale}.json',
        format: 'nested-json',
      },
      localeMap: { zh_cn: 'zh-cn' },
    })
    expect(await cli(['init', '--base-url', BASE_URL], platform({}))).toBe(2)
    expect(err.join('')).toMatch(/already exists/)
  })

  it('init lists sibling directories and infers where new keys go', async () => {
    for (const dir of ['default', 'boostprime']) {
      await put(`src/locales/${dir}/en.json`, '{}')
      await put(`src/locales/${dir}/zh-cn.json`, '{}')
    }
    await put(
      'src/locales/default/en.json',
      '{ "home_title": "Home", "cart_total": "Total" }',
    )
    await put(
      'src/locales/boostprime/en.json',
      '{ "boostprime_promo": "Promo", "boostprime_banner": "Banner" }',
    )
    const base = {
      dir: 'src/locales/default',
      pattern: '{locale}.json',
      format: 'nested-json',
    }
    const second = { ...base, dir: 'src/locales/boostprime' }
    const read = async () =>
      JSON.parse(await readFile(join(root, 'localness.config.json'), 'utf8'))

    expect(await cli(['init', '--base-url', BASE_URL], platform({}))).toBe(0)
    expect((await read()).files).toEqual([
      base,
      { ...second, match: { key: '^boostprime[_.-]' } },
    ])
    expect((await read()).localeMap).toEqual({ zh_cn: 'zh-cn' })

    const named = platform(
      {},
      { namespaces: [{ id: '1', name: 'boostprime', sort: 1 }] },
    )
    expect(await cli(['init', '--base-url', BASE_URL, '--force'], named)).toBe(
      0,
    )
    expect((await read()).files).toEqual([
      base,
      { ...second, match: { namespace: 'boostprime' } },
    ])
  })

  it('pull and sync exit 1 while keys wait for a person, and --into places them', async () => {
    await put(
      'localness.config.json',
      JSON.stringify({
        baseUrl: BASE_URL,
        files: [
          { dir: 'a', match: { key: '^a_' } },
          { dir: 'b', match: { key: '^b_' } },
        ],
      }),
    )
    await put('a/en.json', '{ "dup": "one", "a_x": "X" }')
    await put('b/en.json', '{ "dup": "two" }')
    const fetch = platform({
      dup: { en: 'one' },
      a_x: { en: 'X' },
      a_new: { en: 'New' },
      stray: { en: 'Stray' },
    })

    expect(await cli(['pull', '--json'], fetch)).toBe(1)
    const pulled = JSON.parse(out.join(''))
    expect(
      pulled.files.map((file: { relativePath: string }) => file.relativePath),
    ).toEqual(['a/en.json'])
    expect(pulled.unrouted).toMatchObject([{ key: 'stray', locale: 'en' }])
    expect(pulled.duplicates).toMatchObject([
      {
        key: 'dup',
        platform: 'one',
        locations: [
          { dir: 'a', value: 'one' },
          { dir: 'b', value: 'two' },
        ],
      },
    ])
    expect(pulled.dirs).toEqual(['a', 'b'])

    out.length = 0
    expect(await cli(['sync'], fetch)).toBe(1)
    expect(out.join('')).toMatch(
      /no directory matches 1 key[\s\S]*duplicate key/,
    )

    expect(
      await cli(['pull', '--keys', 'stray', '--into', 'nowhere'], fetch),
    ).toBe(2)
    expect(err.join('')).toMatch(/not a configured directory/)
    expect(
      await cli(['pull', '--keys', 'stray,dup', '--into', 'b'], fetch),
    ).toBe(0)
    expect(JSON.parse(await readFile(join(root, 'b/en.json'), 'utf8'))).toEqual(
      {
        dup: 'one',
        stray: 'Stray',
      },
    )
    expect(
      JSON.parse(await readFile(join(root, 'a/en.json'), 'utf8')),
    ).toMatchObject({
      dup: 'one',
      a_new: 'New',
    })
  })

  it('diff exits 1 until pull brings the files in line', async () => {
    await put(
      'localness.config.json',
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    await put('locales/en.json', '{\n  "title": "Old"\n}\n')
    const fetch = platform({ title: { en: 'Home', zh_cn: '主页' } })

    expect(await cli(['diff', '--json'], fetch)).toBe(1)
    expect(JSON.parse(out.join('')).differences).toEqual([
      {
        locale: 'en',
        key: 'title',
        kind: 'different',
        local: 'Old',
        platform: 'Home',
        draft: 'Home',
        base: null,
        onPlatform: true,
        target: { dir: 'locales', by: 'existing' },
        locations: [
          {
            dir: 'locales',
            relativePath: 'locales/en.json',
            value: 'Old',
            path: ['title'],
          },
        ],
        dirs: ['locales'],
      },
      {
        locale: 'zh_cn',
        key: 'title',
        kind: 'platform-added',
        local: null,
        platform: '主页',
        draft: '主页',
        base: null,
        onPlatform: true,
        target: { dir: 'locales', by: 'existing' },
        locations: [],
        dirs: ['locales'],
      },
    ])

    out.length = 0
    expect(await cli(['pull', '--dry-run'], fetch)).toBe(0)
    expect(out.join('')).toMatch(/Dry run: would write 2 files/)
    expect(await readFile(join(root, 'locales/en.json'), 'utf8')).toBe(
      '{\n  "title": "Old"\n}\n',
    )

    expect(await cli(['pull'], fetch)).toBe(0)
    expect(await readFile(join(root, 'locales/zh-CN.json'), 'utf8')).toBe(
      '{\n  "title": "主页"\n}\n',
    )
    expect(await cli(['diff'], fetch)).toBe(0)
  })

  it('pull --prune keeps array elements and lists them in keptInArray', async () => {
    await put(
      'localness.config.json',
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    await put('locales/en.json', '{ "list": ["One", "Two"] }')
    const fetch = platform({ 'list.0': { en: 'First' } })

    expect(await cli(['pull', '--prune', '--json'], fetch)).toBe(0)
    expect(JSON.parse(out.join('')).files).toMatchObject([
      {
        relativePath: 'locales/en.json',
        set: ['list.0'],
        removed: [],
        keptInArray: ['list.1'],
      },
    ])
    expect(
      JSON.parse(await readFile(join(root, 'locales/en.json'), 'utf8')),
    ).toEqual({ list: ['First', 'Two'] })
  })

  it('diff --json names the config it used, relative to the working directory', async () => {
    for (const app of ['web', 'admin']) {
      await put(
        `apps/${app}/localness.config.json`,
        JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
      )
      await put(`apps/${app}/locales/en.json`, '{ "title": "Home" }')
    }
    const fetch = platform({ title: { en: 'Home' } })
    const config = join(root, 'apps', 'web', 'localness.config.json')

    expect(await cli(['diff', '--json', '--config', config], fetch)).toBe(0)
    expect(JSON.parse(out.join('')).config).toBe(
      'apps/web/localness.config.json',
    )
  })

  it('sync pulls the project changes and plans local ones for apply', async () => {
    await put(
      'localness.config.json',
      JSON.stringify({
        baseUrl: BASE_URL,
        files: { dir: 'locales', format: 'flat-json' },
      }),
    )
    await put('locales/en.json', '{ "title": "Home", "cta": "Go" }')
    await put('locales/zh-CN.json', '{ "title": "主页" }')
    const remote = project({
      title: { en: 'Home', zh_cn: '主页' },
      cta: { en: 'Go' },
    })
    expect(await cli(['sync'], remote.fetch), err.join('')).toBe(0)
    expect(
      await readFile(join(root, '.localness', 'base.json'), 'utf8'),
    ).toMatch(/"title": "Home"/)

    remote.keys.cta!.en = { draftText: 'Go now', publishedText: 'Go now' }
    await put(
      'locales/en.json',
      '{ "title": "Start", "cta": "Go", "new": "New" }',
    )
    await put('locales/zh-CN.json', '{ "title": "主页", "new": "新" }')
    out.length = 0
    expect(await cli(['diff', '--json'], remote.fetch)).toBe(1)
    expect(
      JSON.parse(out.join('')).differences.map(
        (entry: { locale: string; key: string; kind: string }) =>
          `${entry.locale} ${entry.key} ${entry.kind}`,
      ),
    ).toEqual([
      'en cta platform-changed',
      'en new local-added',
      'en title local-changed',
      'zh_cn new local-added',
    ])

    out.length = 0
    expect(await cli(['sync', '--json'], remote.fetch)).toBe(0)
    const { push } = JSON.parse(out.join(''))
    expect(
      JSON.parse(await readFile(join(root, 'locales/en.json'), 'utf8')).cta,
    ).toBe('Go now')
    expect(push.keys.map((item: { key: string }) => item.key)).toEqual([
      'new',
      'title',
    ])
    expect(remote.writes).toEqual([])

    expect(await cli(['apply', push.id], remote.fetch), err.join('')).toBe(0)
    expect(remote.writes.map((write) => write.method)).toEqual([
      'POST',
      'PATCH',
      'PATCH',
    ])
    expect(remote.writes[0]!.client).toMatch(/^cli\/\d+\.\d+\.\d+$/)
    expect(remote.keys.title!.en).toEqual({
      draftText: 'Start',
      publishedText: 'Home',
    })
    expect(await cli(['apply', push.id], remote.fetch)).toBe(2)
    expect(err.join('')).toMatch(/No plan/)

    out.length = 0
    expect(await cli(['diff', '--json'], remote.fetch)).toBe(1)
    expect(
      JSON.parse(out.join('')).differences.map(
        (entry: { key: string; kind: string }) => `${entry.key} ${entry.kind}`,
      ),
    ).toEqual(['title pending-publish', 'new pending-publish'])
  })

  it('apply refuses a plan the project moved past', async () => {
    await put(
      'localness.config.json',
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    await put('locales/en.json', '{ "cta": "Go" }')
    const remote = project({ cta: { en: 'Go' } })
    expect(await cli(['sync'], remote.fetch)).toBe(0)
    await put('locales/en.json', '{ "cta": "Go!" }')
    out.length = 0
    expect(await cli(['push', '--json'], remote.fetch)).toBe(0)
    const { id } = JSON.parse(out.join(''))
    remote.keys.cta!.en = { draftText: 'Other', publishedText: 'Go' }
    expect(await cli(['apply', id], remote.fetch)).toBe(2)
    expect(err.join('')).toMatch(
      /changed since plan .* \(cta\); nothing was written/,
    )
    expect(remote.writes).toEqual([])
  })

  it('releases picks the label for new keys and relabels existing ones', async () => {
    await put(
      'localness.config.json',
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    await put('locales/en.json', '{ "cart": { "buy": "Buy", "pay": "Pay" } }')
    const remote = project({
      'cart.buy': { en: 'Buy' },
      'cart.pay': { en: 'Pay' },
      home: { en: 'Home' },
    })
    const config = async () =>
      JSON.parse(await readFile(join(root, 'localness.config.json'), 'utf8'))

    expect(await cli(['releases', 'use', 'V9'], remote.fetch)).toBe(2)
    expect(err.join('')).toMatch(/no release "V9"; it has v2/)
    expect(await cli(['releases', 'use'], remote.fetch)).toBe(2)
    expect(await cli(['releases', 'use', 'V2'], remote.fetch)).toBe(0)
    expect((await config()).release).toBe('v2')
    out.length = 0
    expect(await cli(['releases'], remote.fetch)).toBe(0)
    expect(out.join('')).toBe('* v2\n')

    expect(await cli(['releases', 'create', 'v3', '--use'], remote.fetch)).toBe(
      0,
    )
    expect((await config()).release).toBe('v3')
    expect(await cli(['releases', 'use', '--none'], remote.fetch)).toBe(0)
    expect((await config()).release).toBeUndefined()

    out.length = 0
    expect(
      await cli(['releases', 'add', 'v2', '--match', 'cart.*'], remote.fetch),
    ).toBe(0)
    expect(out.join('')).toMatch(/cart\.buy\n  cart\.pay\n.*pass --yes/s)
    expect(remote.labels).toEqual({})
    expect(
      await cli(
        ['releases', 'add', 'v2', '--match', 'cart.*', '--yes'],
        remote.fetch,
      ),
    ).toBe(0)
    expect(remote.labels).toEqual({ 'cart.buy': [3], 'cart.pay': [3] })
    expect(
      await cli(['releases', 'remove', 'v2', 'cart.pay'], remote.fetch),
    ).toBe(0)
    expect(remote.labels['cart.pay']).toEqual([])
    expect(await cli(['releases', 'add', 'v2', 'nope'], remote.fetch)).toBe(2)
    expect(err.join('')).toMatch(/no key nope/)

    await cli(['sync'], remote.fetch)
    await cli(['releases', 'use', 'v2'], remote.fetch)
    await put(
      'locales/en.json',
      '{ "cart": { "buy": "Buy", "pay": "Pay", "new": "New" } }',
    )
    out.length = 0
    expect(await cli(['push'], remote.fetch), err.join('')).toBe(0)
    expect(out.join('')).toMatch(/1 key \(1 new, labelled v2\)/)
    const id = /Plan (\S+):/.exec(out.join(''))![1]!
    expect(await cli(['apply', id], remote.fetch), err.join('')).toBe(0)
    expect(remote.labels['cart.new']).toEqual([3])
  })

  it('match lists every key a text has; --json adds the naming rules', async () => {
    await put(
      'localness.config.json',
      JSON.stringify({
        baseUrl: BASE_URL,
        files: { dir: 'locales', pattern: '{locale}.json' },
      }),
    )
    const keyConvention = {
      prefix: 'web',
      separator: '_',
      style: 'snake_case',
      maxDepth: 3,
      guidance: null,
    }
    const base = platform({
      save: { en: 'Save' },
      ok: { en: 'OK' },
      dialog_ok: { en: 'OK' },
    })
    await put(
      'locales/en.json',
      JSON.stringify({
        save: 'Save',
        ok: 'OK',
        draft_ok: ' OK\n',
        hello: 'Hi',
      }),
    )
    const fetch: FetchLike = async (input, init) => {
      const response = await base(input, init)
      if (!new URL(input).pathname.endsWith('/meta')) return response
      const meta = (await response.json()) as object
      const body = {
        ...meta,
        keyConvention,
        namespaces: [{ id: 1, name: 'cart', sort: 0 }],
      }
      return { ...response, json: async () => body }
    }
    expect(await cli(['match', 'Save', 'OK', 'Hello'], fetch)).toBe(0)
    expect(out.join('')).toBe(
      '"Save" -> save\n"OK" -> 3 keys, pick one: ok, dialog_ok, draft_ok (local)\n"Hello" -> no key\n',
    )
    out.length = 0
    expect(await cli(['match', '--json', 'Save'], fetch)).toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({
      matches: [{ text: 'Save', keys: [{ key: 'save', source: 'platform' }] }],
      convention: keyConvention,
      namespaces: ['cart'],
    })
    expect(await cli(['match'], fetch)).toBe(2)
  })

  it('fails without a token', async () => {
    await put('localness.config.json', JSON.stringify({ baseUrl: BASE_URL }))
    expect(await cli(['diff'], platform({}), '')).toBe(2)
    expect(err.join('')).toMatch(/LOCALNESS_TOKEN/)
  })

  it('prefers the token in .env.local next to the config', async () => {
    await put(
      'localness.config.json',
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    await put('.env.local', '# local\nexport LOCALNESS_TOKEN="lnk_file"\n')
    const seen: string[] = []
    const fetch: FetchLike = (input, init) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '')
      return platform({})(input, init)
    }
    expect(await cli(['diff'], fetch, 'lnk_env'), err.join('')).toBe(0)
    expect(seen).not.toHaveLength(0)
    expect(seen.every((value) => value === 'Bearer lnk_file')).toBe(true)
  })

  it('skill install writes one Skill, keeps hand edits and flags old copies', async () => {
    await mkdir(join(root, '.git'))
    await put(
      'app/localness.config.json',
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    const skill = join(root, '.claude/skills/localness/SKILL.md')
    const install = (...args: string[]) =>
      run(['skill', 'install', ...args], {
        cwd: join(root, 'app'),
        env: {},
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        home: join(root, 'home'),
      })

    expect(await install(), err.join('')).toBe(0)
    const text = await readFile(skill, 'utf8')
    expect(text).toMatch(/^name: localness$/m)
    expect(text).not.toMatch(/\{\{version\}\}|localness-hash: ''/)
    out.length = 0
    expect(await install()).toBe(0)
    expect(out.join('')).toMatch(/unchanged/)

    await writeFile(skill, `${text}\nExtra rule.\n`)
    expect(await install()).toBe(2)
    expect(await readFile(skill, 'utf8')).toMatch(/Extra rule/)
    expect(await install('--force')).toBe(0)
    expect(await readFile(skill, 'utf8')).toBe(text)

    const reference = join(dirname(skill), 'references', 'extract.md')
    const referenceText = await readFile(reference, 'utf8')
    await writeFile(reference, `${referenceText}\nExtra step.\n`)
    expect(await install()).toBe(2)
    expect(await install('--force')).toBe(0)
    expect(await readFile(reference, 'utf8')).toBe(referenceText)

    // A single-file install from an older CLI is replaced, not kept as edited.
    await rm(dirname(reference), { recursive: true })
    const single = text.replace(/localness-hash: '[^']*'/, "localness-hash: ''")
    const hash = createHash('sha256').update(single).digest('hex').slice(0, 16)
    await writeFile(
      skill,
      single.replace("localness-hash: ''", `localness-hash: '${hash}'`),
    )
    expect(await install()).toBe(0)
    expect(await readFile(reference, 'utf8')).toBe(referenceText)

    await writeFile(
      skill,
      text.replace(/localness-cli: '[^']*'/, "localness-cli: '0.0.1'"),
    )
    await cli(['diff'], platform({}))
    expect(err.join('')).toMatch(/is for CLI 0\.0\.1/)
  })

  it('skill install --agents-md adds or replaces its block', async () => {
    await mkdir(join(root, '.git'))
    await put('AGENTS.md', '# Repo\n\nBuild with pnpm.\n')
    const install = () =>
      cli(['skill', 'install', '--agent', 'codex', '--agents-md'], platform({}))

    expect(await install(), err.join('')).toBe(0)
    expect(await install()).toBe(0)
    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8')
    expect(agents).toMatch(
      /^# Repo\n\nBuild with pnpm\.\n\n<!-- localness:start -->/,
    )
    expect(agents.match(/localness:start/g)).toHaveLength(1)
    expect(agents).toContain('.agents/skills/localness/SKILL.md')
  })

  it('skill install --root puts it in a subfolder and diff still checks it', async () => {
    await mkdir(join(root, '.git'))
    await put(
      'app/localness.config.json',
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    expect(await cli(['skill', 'install', '--root', 'app'], platform({}))).toBe(
      0,
    )
    const skill = join(root, 'app/.claude/skills/localness/SKILL.md')
    const text = await readFile(skill, 'utf8')
    await writeFile(
      skill,
      text.replace(/localness-cli: '[^']*'/, "localness-cli: '0.0.1'"),
    )
    await cli(['diff', '--config', 'app/localness.config.json'], platform({}))
    expect(err.join('')).toMatch(/is for CLI 0\.0\.1.*--root app/)
  })

  it('skill install --global writes into the home folder', async () => {
    await mkdir(join(root, '.git'))
    await put(
      'localness.config.json',
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    const skill = join(root, 'home/.cursor/skills/localness/SKILL.md')
    expect(
      await cli(
        ['skill', 'install', '--global', '--agent', 'cursor'],
        platform({}),
      ),
      err.join(''),
    ).toBe(0)
    expect(out.join('')).toContain(
      join('~', '.cursor/skills/localness/SKILL.md'),
    )
    const text = await readFile(skill, 'utf8')
    expect(text).toMatch(/^name: localness$/m)
    await expect(
      readFile(join(root, '.claude/skills/localness/SKILL.md')),
    ).rejects.toThrow()

    await writeFile(
      skill,
      text.replace(/localness-cli: '[^']*'/, "localness-cli: '0.0.1'"),
    )
    await cli(['diff'], platform({}))
    expect(err.join('')).toMatch(/is for CLI 0\.0\.1.*install --global/)
  })

  it('skill install --global refuses --root and --agents-md', async () => {
    for (const flag of ['--root', '--agents-md']) {
      const args = flag === '--root' ? [flag, 'app'] : [flag]
      err.length = 0
      expect(
        await cli(['skill', 'install', '--global', ...args], platform({})),
      ).toBe(2)
      expect(err.join('')).toContain(`--global cannot be combined with ${flag}`)
    }
  })
})

describe('skillDirsFor', () => {
  it('picks the fewest home folders the agents read', () => {
    expect(skillDirsFor(['cursor'], GLOBAL_SKILLS)).toEqual(['.cursor/skills'])
    expect(
      skillDirsFor(['copilot', 'claude', 'cursor'], GLOBAL_SKILLS),
    ).toEqual(['.claude/skills', '.copilot/skills'])
    expect(skillDirsFor(['codex'], GLOBAL_SKILLS)).toEqual(['.agents/skills'])
  })

  it('picks the fewest folders the agents read', () => {
    expect(skillDirsFor(['copilot', 'claude', 'cursor'])).toEqual([
      '.claude/skills',
    ])
    expect(skillDirsFor(['copilot'])).toEqual(['.github/skills'])
    expect(skillDirsFor(['copilot', 'cursor'])).toEqual(['.agents/skills'])
    expect(skillDirsFor(['claude', 'codex']).sort()).toEqual([
      '.agents/skills',
      '.claude/skills',
    ])
  })
})

describe('clientOf', () => {
  it('marks runs inside a coding agent, unless LOCALNESS_AGENT says otherwise', () => {
    expect(clientOf({})).toMatch(/^cli\/[\d.]+$/)
    expect(clientOf({ CLAUDECODE: '1' })).toMatch(/; agent$/)
    expect(clientOf({ CLAUDECODE: '1', LOCALNESS_AGENT: '0' })).not.toMatch(
      /agent/,
    )
    expect(clientOf({ LOCALNESS_AGENT: '1' })).toMatch(/; agent$/)
  })
})

describe('parseEnvFile', () => {
  it('reads quoted, exported and commented values', () => {
    expect(
      parseEnvFile(
        '# c\nexport A=1\nB = \'two words\'\nC=x # note\nD="#hash"\nbad line\n',
      ),
    ).toEqual({ A: '1', B: 'two words', C: 'x', D: '#hash' })
  })
})
