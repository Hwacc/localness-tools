import { contentHash, stableStringify } from './hash'
import type { CacheEntry, CacheStore } from './store'

export interface CacheKeyParts {
  baseUrl: string
  project?: string | number | undefined
  /** What is cached, e.g. `keyStates` or `locale`. */
  resource: string
  locales?: readonly string[] | undefined
  release?: string | number | undefined
  namespace?: string | undefined
}

export function cacheKey(parts: CacheKeyParts): string {
  return stableStringify({
    ...parts,
    baseUrl: parts.baseUrl.replace(/\/+$/, ''),
    project: parts.project === undefined ? undefined : String(parts.project),
    release: parts.release === undefined ? undefined : String(parts.release),
    locales: parts.locales && [...parts.locales].sort(),
  })
}

export interface RefreshResult<T> {
  value: T
  hash: string
  fetchedAt: number
  /** False when the fetched data hashes the same as what was cached. */
  changed: boolean
}

export interface LoadOptions<T> {
  /** A cached entry younger than this is returned without a background refresh. */
  maxAgeMs?: number
  /** Called when a background refresh finishes (also when nothing changed). */
  onRefresh?: (result: RefreshResult<T>) => void
  onError?: (error: unknown) => void
}

export interface CachedResource<T> {
  /** The cached entry, or undefined on a miss. Never touches the network. */
  peek(): Promise<CacheEntry<T> | undefined>
  /** Fetches, stores, and reports whether the content hash differs from the cached one. */
  refresh(): Promise<RefreshResult<T>>
  /** Stale-while-revalidate: cached entry immediately, refreshed in the background. A miss awaits the fetch. */
  load(options?: LoadOptions<T>): Promise<CacheEntry<T>>
  clear(): Promise<void>
}

export interface CachedResourceOptions<T> {
  store: CacheStore
  key: string | CacheKeyParts
  load: () => Promise<T>
  /** Top-level fields left out of the hash. Defaults to `generatedAt`, which changes on every response. */
  hashIgnore?: readonly string[]
  now?: () => number
}

function hashValue(value: unknown, ignore: readonly string[]): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return contentHash(value)
  }
  const kept = Object.fromEntries(
    Object.entries(value).filter(([name]) => !ignore.includes(name)),
  )
  return contentHash(kept)
}

export function createCachedResource<T>(
  options: CachedResourceOptions<T>,
): CachedResource<T> {
  const { store, hashIgnore = ['generatedAt'], now = Date.now } = options
  const key =
    typeof options.key === 'string' ? options.key : cacheKey(options.key)
  let inflight: Promise<RefreshResult<T>> | undefined

  async function peek() {
    return (await store.get(key)) as CacheEntry<T> | undefined
  }

  async function fetchAndStore(): Promise<RefreshResult<T>> {
    const previous = await peek()
    const value = await options.load()
    const entry: CacheEntry<T> = {
      value,
      hash: hashValue(value, hashIgnore),
      fetchedAt: now(),
    }
    await store.set(key, entry)
    return { ...entry, changed: previous?.hash !== entry.hash }
  }

  function refresh() {
    inflight ??= fetchAndStore().finally(() => {
      inflight = undefined
    })
    return inflight
  }

  return {
    peek,
    refresh,
    async load(loadOptions = {}) {
      const cached = await peek()
      if (!cached) return refresh()
      const fresh =
        loadOptions.maxAgeMs !== undefined &&
        now() - cached.fetchedAt < loadOptions.maxAgeMs
      if (!fresh) {
        refresh().then(loadOptions.onRefresh, loadOptions.onError)
      }
      return cached
    },
    clear: () => store.delete(key),
  }
}
