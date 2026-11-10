import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export interface CacheEntry<T = unknown> {
  value: T
  /** Stable content hash of `value`, volatile fields excluded. */
  hash: string
  /** Epoch milliseconds of the last successful fetch. */
  fetchedAt: number
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>
  set(key: string, entry: CacheEntry): Promise<void>
  delete(key: string): Promise<void>
}

export class MemoryStore implements CacheStore {
  readonly #entries = new Map<string, CacheEntry>()

  async get(key: string) {
    return this.#entries.get(key)
  }

  async set(key: string, entry: CacheEntry) {
    this.#entries.set(key, entry)
  }

  async delete(key: string) {
    this.#entries.delete(key)
  }
}

export interface FileStoreOptions {
  /** Directory the entries are written to, e.g. a VS Code `globalStorageUri.fsPath`. */
  dir: string
}

function isEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    'value' in entry &&
    typeof entry.hash === 'string' &&
    typeof entry.fetchedAt === 'number'
  )
}

export class FileStore implements CacheStore {
  readonly #dir: string

  constructor(options: FileStoreOptions) {
    this.#dir = options.dir
  }

  #fileFor(key: string) {
    const name = createHash('sha256').update(key).digest('hex')
    return join(this.#dir, `${name}.json`)
  }

  async get(key: string) {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.#fileFor(key), 'utf8'),
      )
      return isEntry(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }

  async set(key: string, entry: CacheEntry) {
    await mkdir(this.#dir, { recursive: true })
    const file = this.#fileFor(key)
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, JSON.stringify(entry), 'utf8')
    await rename(temp, file)
  }

  async delete(key: string) {
    await rm(this.#fileFor(key), { force: true })
  }
}
