import { describe, expect, it } from 'vitest'
import { LocalnessError, createClient } from '../src'
import { BASE_URL, TOKEN, mockFetch } from './helpers'

function stateKey(id: number) {
  return {
    id,
    key: `k${id}`,
    releaseIds: [],
    draft: false,
    locales: {
      ja: { draftText: null, publishedText: 'x', state: 'published' as const },
    },
  }
}

function statesPage(
  offset: number,
  count: number,
  total: number,
  limit: number,
) {
  return {
    sourceLocale: 'en',
    keys: Array.from({ length: count }, (_, i) => stateKey(offset + i)),
    total,
    offset,
    limit,
    generatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('client requests', () => {
  it('sends the bearer token and the project', async () => {
    const { fetch, calls } = mockFetch({
      body: { projects: [], generatedAt: 'now' },
    })
    const client = createClient({
      baseUrl: `${BASE_URL}/`,
      token: TOKEN,
      project: 'web',
      fetch,
    })
    await client.projects()
    expect(calls[0]!.url.toString()).toBe(`${BASE_URL}/api/v1/projects`)
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`)

    const { fetch: f2, calls: c2 } = mockFetch({ body: { outdated: {} } })
    await createClient({
      baseUrl: BASE_URL,
      token: TOKEN,
      project: 7,
      fetch: f2,
    }).outdated()
    expect(c2[0]!.url.searchParams.get('project')).toBe('7')
  })

  it('encodes the locale and passes the scope', async () => {
    const { fetch, calls } = mockFetch({ body: { a: 'b' } })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    await expect(
      client.locale('zh/CN', { release: 'v1', namespace: 'app', project: 3 }),
    ).resolves.toEqual({ a: 'b' })
    const { url } = calls[0]!
    expect(url.pathname).toBe('/api/v1/locales/zh%2FCN')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      project: '3',
      release: 'v1',
      namespace: 'app',
    })
  })

  it('searches keys', async () => {
    const { fetch, calls } = mockFetch({
      body: {
        keys: [
          { id: 1, key: 'a', sourceText: 'A', draft: false, releaseIds: [] },
        ],
        total: 1,
      },
    })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const result = await client.searchKeys('a', { limit: 5 })
    expect(result.total).toBe(1)
    expect(calls[0]!.url.searchParams.get('q')).toBe('a')
    expect(calls[0]!.url.searchParams.get('limit')).toBe('5')
  })

  it('keeps sourceLocale on meta', async () => {
    const { fetch } = mockFetch({
      body: {
        project: { id: 1, name: 'Web' },
        locales: ['en', 'ja'],
        sourceLocale: 'en',
        localeFallback: 'en',
        release: null,
        releases: [],
        coverage: { keys: 1, projectKeys: 1, publishedPerLocale: {} },
        canManageReleases: false,
        generatedAt: 'now',
      },
    })
    const meta = await createClient({
      baseUrl: BASE_URL,
      token: TOKEN,
      fetch,
    }).meta()
    expect(meta.sourceLocale).toBe('en')
  })
})

describe('keyStates pagination', () => {
  const total = 5

  function paged() {
    return mockFetch(({ url }) => {
      const offset = Number(url.searchParams.get('offset'))
      const limit = Number(url.searchParams.get('limit'))
      const count = Math.min(limit, total - offset)
      return { body: statesPage(offset, count, total, limit) }
    })
  }

  it('fetches every page', async () => {
    const { fetch, calls } = paged()
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const result = await client.keyStates({
      locales: ['ja', 'en'],
      pageSize: 2,
      release: 4,
    })
    expect(result.keys.map((k) => k.id)).toEqual([0, 1, 2, 3, 4])
    expect(result.total).toBe(5)
    expect(result.sourceLocale).toBe('en')
    expect(calls.map((c) => c.url.searchParams.get('offset'))).toEqual([
      '0',
      '2',
      '4',
    ])
    expect(calls[0]!.url.searchParams.get('locales')).toBe('ja,en')
    expect(calls[0]!.url.searchParams.get('release')).toBe('4')
  })

  it('clamps the page size to the server maximum', async () => {
    const { fetch, calls } = paged()
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    await client.keyStates({ locales: ['en'], pageSize: 99999 })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url.searchParams.get('limit')).toBe('5000')
  })

  it('iterates pages lazily', async () => {
    const { fetch, calls } = paged()
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const sizes: number[] = []
    for await (const page of client.keyStatePages({
      locales: ['en'],
      pageSize: 2,
    })) {
      sizes.push(page.keys.length)
      if (sizes.length === 2) break
    }
    expect(sizes).toEqual([2, 2])
    expect(calls).toHaveLength(2)
  })

  it('stops on an empty page even if total is larger', async () => {
    const { fetch, calls } = mockFetch(({ url }) => ({
      body: statesPage(Number(url.searchParams.get('offset')), 0, 10, 2),
    }))
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    const result = await client.keyStates({ locales: ['en'], pageSize: 2 })
    expect(result.keys).toEqual([])
    expect(calls).toHaveLength(1)
  })
})

describe('error mapping', () => {
  async function failure(reply: Parameters<typeof mockFetch>[0]) {
    const { fetch } = mockFetch(reply)
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    return client.meta().catch((error: unknown) => error)
  }

  it.each([
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'ambiguous-project'],
    [400, 'bad-request'],
    [503, 'server'],
  ])('maps %i to %s with the server message', async (status, code) => {
    const error = await failure({
      status,
      body: { statusMessage: 'Server said no' },
    })
    expect(error).toBeInstanceOf(LocalnessError)
    expect(error).toMatchObject({
      code,
      status,
      serverMessage: 'Server said no',
    })
  })

  it('maps a thrown fetch to network without leaking the URL or token', async () => {
    const error = (await failure({
      throws: new Error(`connect failed ${BASE_URL}?t=${TOKEN}`),
    })) as LocalnessError
    expect(error.code).toBe('network')
    expect(error.status).toBeUndefined()
    expect(error.message).not.toContain(TOKEN)
    expect(error.message).not.toContain('localness.example.com')
  })

  it('maps a wrong shape to invalid-response', async () => {
    const error = (await failure({ body: { nope: true } })) as LocalnessError
    expect(error.code).toBe('invalid-response')
    expect(error.message).toContain('/api/v1/meta')
  })

  it('maps a non-JSON success body to invalid-response', async () => {
    const { fetch } = mockFetch({ rawBody: '{' })
    const client = createClient({ baseUrl: BASE_URL, token: TOKEN, fetch })
    await expect(client.meta()).rejects.toMatchObject({
      code: 'invalid-response',
    })
  })

  it('redacts the token from server messages and keeps queries out of messages', async () => {
    const { fetch } = mockFetch({
      status: 401,
      body: { message: `bad ${TOKEN}` },
    })
    const client = createClient({
      baseUrl: BASE_URL,
      token: TOKEN,
      project: 'secret-project',
      fetch,
    })
    const error = (await client
      .meta()
      .catch((e: unknown) => e)) as LocalnessError
    expect(error.serverMessage).toBe('bad ***')
    expect(error.message).not.toContain(TOKEN)
    expect(error.message).not.toContain('secret-project')
    expect(error.message).not.toContain('?')
  })
})
