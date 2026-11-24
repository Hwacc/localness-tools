import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalnessClient } from '../client'
import type { LoadedConfig } from '../sync/config'
import { readLocalFiles } from '../sync/local'
import { STATE_DIR } from '../sync/state'

const KEEP_MS = 24 * 60 * 60 * 1000

/** Who shows a review: a browser page (`url`) or an editor (`editor`). */
export interface ReviewClaim {
  pid?: number
  url?: string
  editor?: 'vscode'
  error?: string
}

export function isReviewId(id: string) {
  return /^[a-f0-9]{8}$/.test(id)
}

export function reviewDir(root: string) {
  return join(root, STATE_DIR, 'review')
}

export function reviewPaths(root: string, id: string) {
  if (!isReviewId(id)) throw new Error(`Invalid review id: ${id}`)
  const dir = reviewDir(root)
  return {
    doc: join(dir, `${id}.json`),
    claim: join(dir, `${id}.server.json`),
    result: join(dir, `${id}.result.json`),
  }
}

const ignoreCode =
  (code: string) =>
  (error: unknown): null => {
    if ((error as NodeJS.ErrnoException).code === code) return null
    throw error
  }

export async function readJson<T>(path: string): Promise<T | null> {
  const source = await readFile(path, 'utf8').catch(ignoreCode('ENOENT'))
  return source === null ? null : (JSON.parse(source) as T)
}

export function writeJson(path: string, value: unknown) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/** Writes the claim unless someone else already did; false when taken. */
export async function claimReview(path: string, claim: ReviewClaim) {
  const written = await writeFile(path, `${JSON.stringify(claim)}\n`, {
    flag: 'wx',
  })
    .then(() => true)
    .catch(ignoreCode('EEXIST'))
  return written === true
}

export function isAlive(pid: number | undefined) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function ensureStateDir(root: string, sub: string) {
  const dir = join(root, STATE_DIR)
  await mkdir(join(dir, sub), { recursive: true })
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(
    ignoreCode('EEXIST'),
  )
  return join(dir, sub)
}

/** Creates the review folder and drops files older than a day. */
export async function prepareReviewDir(root: string, now = Date.now()) {
  const dir = await ensureStateDir(root, 'review')
  for (const name of await readdir(dir)) {
    const path = join(dir, name)
    const { mtimeMs } = await stat(path)
    if (now - mtimeMs > KEEP_MS) await rm(path, { force: true })
  }
}

const editorsDir = (root: string) => join(root, STATE_DIR, 'editors')

/** Review pages this build of the extension can show. */
export const EDITOR_REVIEW_KINDS = ['extract', 'resolve'] as const
export type EditorReviewKind = (typeof EDITOR_REVIEW_KINDS)[number]

interface EditorAnnounce {
  pid: number
  /** Absent on extensions that only show extract reviews. */
  kinds?: readonly string[]
}

/** Tells `review start` that an editor with the extension has this project open. */
export async function announceEditor(root: string, pid = process.pid) {
  const dir = await ensureStateDir(root, 'editors')
  await writeJson(join(dir, `${pid}.json`), {
    pid,
    kinds: [...EDITOR_REVIEW_KINDS],
  })
}

export async function withdrawEditor(root: string, pid = process.pid) {
  await rm(join(editorsDir(root), `${pid}.json`), { force: true })
}

function announcedKinds(value: EditorAnnounce | null): EditorReviewKind[] {
  if (!value?.kinds) return ['extract']
  return value.kinds.filter(
    (kind): kind is EditorReviewKind =>
      kind === 'extract' || kind === 'resolve',
  )
}

/**
 * Whether every live editor can show `kind`. One that cannot (an older
 * extension, which names no kinds) makes this false, so the page opens in
 * the browser instead of being claimed by that extension. Forgets editors
 * that died.
 */
export async function hasEditor(
  root: string,
  kind: EditorReviewKind = 'extract',
) {
  const names = await readdir(editorsDir(root)).catch(ignoreCode('ENOENT'))
  let capable = false
  let incapable = false
  for (const name of names ?? []) {
    const pid = Number(name.replace(/\.json$/, ''))
    if (!isAlive(pid)) {
      await rm(join(editorsDir(root), name), { force: true })
      continue
    }
    const announced = await readJson<EditorAnnounce>(
      join(editorsDir(root), name),
    )
    if (announcedKinds(announced).includes(kind)) capable = true
    else incapable = true
  }
  return capable && !incapable
}

/** The `taken` check of a review: names in the source-locale file or on the project. */
export function takenNames(
  loaded: LoadedConfig,
  client: LocalnessClient,
  sourceLocale: string,
) {
  return async (names: string[]) => {
    const found = new Set<string>()
    if (names.length === 0) return found
    const [local] =
      loaded.config.files && sourceLocale
        ? (await readLocalFiles(loaded, [sourceLocale])).locales
        : []
    for (const name of names) {
      if (local && name in local.locations) found.add(name)
    }
    const { keys } = await client.keyStates({
      keys: names,
      locales: sourceLocale ? [sourceLocale] : undefined,
    })
    for (const { key } of keys) found.add(key)
    return found
  }
}
