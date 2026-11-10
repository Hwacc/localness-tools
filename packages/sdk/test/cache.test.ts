import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FileStore,
  MemoryStore,
  cacheKey,
  contentHash,
  createCachedResource,
  stableStringify,
  type CacheStore,
} from '../src'

describe('stable hash', () => {
  it('ignores key order at every depth', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } })).toBe(
      contentHash({ b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 }),
    )
    expect(stableStringify({ b: 1, a: undefined })).toBe('{"b":1}')
  })

  it('changes when the data changes', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]))
  })
})

describe('cacheKey', () => {
  const base = {
    baseUrl: 'https://localness.example.com',
    resource: 'keyStates',
  }

  it('is stable across locale order and trailing slashes', () => {
    expect(cacheKey({ ...base, locales: ['ja', 'en'] })).toBe(
      cacheKey({ ...base, baseUrl: `${base.baseUrl}/`, locales: ['en', 'ja'] }),
    )
  })

  it('separates project, locales and scope', () => {
    const keys = [
      cacheKey({ ...base, project: 1, locales: ['en'] }),
      cacheKey({ ...base, project: 2, locales: ['en'] }),
      cacheKey({ ...base, project: 1, locales: ['en', 'ja'] }),
      cacheKey({ ...base, project: 1, locales: ['en'], release: 'v1' }),
      cacheKey({ ...base, project: 1, locales: ['en'], namespace: 'app' }),
      cacheKey({
        ...base,
        baseUrl: 'https://other.example.com',
        project: 1,
        locales: ['en'],
      }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe.each([['memory'], ['file']])(
  'cached resource with %s store',
  (kind) => {
    let dir: string
    let store: CacheStore

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'localness-sdk-'))
      store = kind === 'memory' ? new MemoryStore() : new FileStore({ dir })
    })
    afterEach(() => rm(dir, { recursive: true, force: true }))

    function resource(load: () => Promise<unknown>, now = Date.now) {
      return createCachedResource({ store, key: 'k', load, now })
    }

    it('misses, then hits, and detects changes by content hash', async () => {
      const load = vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValueOnce({ keys: ['a'], generatedAt: '1' })
        .mockResolvedValueOnce({ generatedAt: '2', keys: ['a'] })
        .mockResolvedValueOnce({ keys: ['a', 'b'], generatedAt: '3' })
      const res = resource(load)

      expect(await res.peek()).toBeUndefined()
      expect(await res.refresh()).toMatchObject({ changed: true })
      expect(await res.peek()).toMatchObject({ value: { keys: ['a'] } })
      expect((await res.refresh()).changed).toBe(false)
      expect((await res.refresh()).changed).toBe(true)
      expect(load).toHaveBeenCalledTimes(3)
    })

    it('shares one in-flight refresh', async () => {
      const load = vi.fn(async () => ({ a: 1 }))
      const res = resource(load)
      await Promise.all([res.refresh(), res.refresh()])
      expect(load).toHaveBeenCalledTimes(1)
    })

    it('load awaits the fetch on a miss', async () => {
      const res = resource(async () => ({ a: 1 }))
      expect(await res.load()).toMatchObject({ value: { a: 1 } })
    })

    it('load returns the cache at once and refreshes in the background', async () => {
      let value = { a: 1 }
      const res = resource(async () => value)
      await res.refresh()
      value = { a: 2 }

      const refreshed = new Promise<{ changed: boolean }>((resolve) => {
        void res.load({ onRefresh: resolve }).then((entry) => {
          expect(entry.value).toEqual({ a: 1 })
        })
      })
      expect(await refreshed).toMatchObject({ changed: true })
      expect(await res.peek()).toMatchObject({ value: { a: 2 } })
    })

    it('skips the background refresh while fresh and reports errors when stale', async () => {
      let time = 1000
      const load = vi.fn(async () => ({ a: 1 }))
      const res = resource(load, () => time)
      await res.refresh()

      time = 1500
      await res.load({ maxAgeMs: 1000 })
      expect(load).toHaveBeenCalledTimes(1)

      time = 5000
      load.mockRejectedValueOnce(new Error('offline'))
      const error = await new Promise((resolve) => {
        void res.load({ maxAgeMs: 1000, onError: resolve })
      })
      expect(error).toMatchObject({ message: 'offline' })
      expect(await res.peek()).toMatchObject({ value: { a: 1 } })
    })

    it('clear drops the entry', async () => {
      const res = resource(async () => ({ a: 1 }))
      await res.refresh()
      await res.clear()
      expect(await res.peek()).toBeUndefined()
    })
  },
)

describe('FileStore', () => {
  it('persists across instances and treats corrupt files as a miss', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'localness-sdk-')), 'nested')
    try {
      const entry = { value: { a: 1 }, hash: 'h', fetchedAt: 1 }
      await new FileStore({ dir }).set('key', entry)
      expect(await new FileStore({ dir }).get('key')).toEqual(entry)

      const [file] = await readdir(dir)
      await writeFile(join(dir, file!), '{not json')
      expect(await new FileStore({ dir }).get('key')).toBeUndefined()
      expect(await new FileStore({ dir }).get('other')).toBeUndefined()
    } finally {
      await rm(join(dir, '..'), { recursive: true, force: true })
    }
  })
})
