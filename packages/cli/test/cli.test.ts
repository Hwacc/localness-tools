import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FetchLike } from '@localness/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupLocaleFiles, matchLocales } from '../src/init'
import { parseEnvFile } from '../src/env'
import { run } from '../src/run'

const BASE_URL = 'https://localness.example.com'

/** The project: `en` and `zh_cn`, with published text per key. */
function platform(keys: Record<string, Record<string, string>>): FetchLike {
  return async (input) => {
    const url = new URL(input)
    const body = url.pathname.endsWith('/meta')
      ? {
          project: { id: 1, name: 'Web' },
          locales: ['en', 'zh_cn'],
          sourceLocale: 'en',
          localeFallback: 'en',
          release: null,
          releases: [],
          coverage: { keys: 0, projectKeys: 0, publishedPerLocale: {} },
          canManageReleases: false,
          generatedAt: 'now',
        }
      : {
          sourceLocale: 'en',
          keys: Object.entries(keys).map(([key, texts], id) => ({
            id,
            key,
            releaseIds: [],
            draft: false,
            locales: Object.fromEntries(
              Object.entries(texts).map(([locale, text]) => [
                locale,
                { draftText: null, publishedText: text, state: 'published' },
              ]),
            ),
          })),
          total: Object.keys(keys).length,
          offset: 0,
          limit: 1000,
          generatedAt: 'now',
        }
    return { ok: true, status: 200, json: async () => body }
  }
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
      },
      {
        locale: 'zh_cn',
        key: 'title',
        kind: 'missing-locally',
        local: null,
        platform: '主页',
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

describe('parseEnvFile', () => {
  it('reads quoted, exported and commented values', () => {
    expect(
      parseEnvFile(
        '# c\nexport A=1\nB = \'two words\'\nC=x # note\nD="#hash"\nbad line\n',
      ),
    ).toEqual({ A: '1', B: 'two words', C: 'x', D: '#hash' })
  })
})
