import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FetchLike } from '@localness/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupLocaleFiles, matchLocales } from '../src/init'
import { parseEnvFile } from '../src/env'
import { run } from '../src/run'
import { clientOf } from '../src/shared'

const BASE_URL = 'https://localness.example.com'

type Texts = Record<
  string,
  { draftText: string | null; publishedText: string | null }
>

/**
 * The project: `en` and `zh_cn`. Pass published text per key; the returned
 * `keys` is the live state, so tests can edit it and see writes land.
 */
function project(initial: Record<string, Record<string, string>> = {}) {
  const keys: Record<string, Texts> = {}
  for (const [key, texts] of Object.entries(initial)) {
    keys[key] = {}
    for (const [locale, text] of Object.entries(texts)) {
      keys[key][locale] = { draftText: text, publishedText: text }
    }
  }
  const writes: { method: string; body: unknown; client?: string }[] = []
  const state = (key: string, id = 0) => ({
    id,
    key,
    releaseIds: [],
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
        releases: [],
        coverage: { keys: 0, projectKeys: 0, publishedPerLocale: {} },
        canManageReleases: false,
        generatedAt: 'now',
      })
    }
    if (method !== 'GET') {
      const body = JSON.parse(init!.body!) as {
        key: string
        sourceText?: string
        locales?: Record<string, { text: string; expected: string }>
      }
      writes.push({
        method,
        body,
        client: init?.headers?.['x-localness-client'],
      })
      if (method === 'POST') {
        keys[body.key] = {
          en: { draftText: body.sourceText!, publishedText: body.sourceText! },
        }
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
      keys: names.map((key, id) => state(key, id)),
      total: names.length,
      offset: 0,
      limit: 1000,
      generatedAt: 'now',
    })
  }
  return { fetch, keys, writes }
}

function platform(keys: Record<string, Record<string, string>>): FetchLike {
  return project(keys).fetch
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
