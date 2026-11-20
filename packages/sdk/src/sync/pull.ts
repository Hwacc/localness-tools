import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  unwritableKeys,
  writeLocaleFile,
} from '@localness/contract/locale-file'
import { normalizeDir, type LoadedConfig } from './config'
import type { Comparison, DiffEntry, DiffKind } from './diff'
import { writeBase, type BaseTexts } from './state'

/** What `pull` writes: the project's changes, and `different` when there is no base to judge. */
export const PULL_KINDS: readonly DiffKind[] = [
  'platform-added',
  'platform-changed',
  'different',
]
/** `sync` leaves `different` alone: either side may be the newer one. */
export const SYNC_PULL_KINDS: readonly DiffKind[] = [
  'platform-added',
  'platform-changed',
]
/** `pull --keys`: the named keys take the project's text whatever changed. */
export const FORCED_PULL_KINDS: readonly DiffKind[] = [
  ...PULL_KINDS,
  'local-changed',
  'local-deleted',
  'conflict',
  'duplicate',
]

export interface PullOptions {
  kinds: readonly DiffKind[]
  /** Also remove keys the platform does not know. */
  prune?: boolean
  /**
   * A configured `dir` for keys that have no place yet: unrouted ones, and
   * duplicates the project added a locale to. Keys with a place keep it.
   */
  into?: string
}

export interface PullFile {
  locale: string
  /** Normalized `dir` of the config entry. */
  dir: string
  path: string
  relativePath: string
  created: boolean
  /** Keys written with the platform's text. */
  set: string[]
  removed: string[]
  /** New keys whose path collides with the file's structure; left out. */
  skipped: string[]
  /** The new file content, or null when nothing is written. */
  output: string | null
}

export interface PullPlan {
  files: PullFile[]
  /** Keys to write that match no directory; pass `into` to place them. */
  unrouted: DiffEntry[]
  /** Duplicate keys left alone: their texts differ, or they have no place in this locale. */
  duplicates: DiffEntry[]
}

/**
 * The project's text for each entry of `kinds`, written to every directory
 * that has the key. Keys the project lacks stay unless `prune`; keys without
 * project text are never touched.
 */
export function planPull(
  comparison: Comparison,
  options: PullOptions,
): PullPlan {
  const kinds = new Set(options.kinds)
  const into =
    options.into === undefined ? undefined : normalizeDir(options.into)
  if (
    into !== undefined &&
    !comparison.files.some((file) => file.dir === into)
  ) {
    const dirs = [...new Set(comparison.files.map((file) => file.dir))]
    throw new Error(
      `"${options.into}" is not a configured directory; the config has ${dirs.join(', ')}.`,
    )
  }
  const writes = new Map<string, Record<string, string | null>>()
  const unrouted: DiffEntry[] = []
  const duplicates: DiffEntry[] = []
  const put = (
    entry: DiffEntry,
    dirs: readonly string[],
    text: string | null,
  ) => {
    for (const dir of dirs) {
      const id = `${entry.locale}\0${dir}`
      const own = writes.get(id) ?? Object.create(null)
      own[entry.key] = text
      writes.set(id, own)
    }
  }

  for (const entry of comparison.entries) {
    if (!entry.onPlatform && options.prune) {
      put(
        entry,
        entry.locations.map((place) => place.dir),
        null,
      )
      continue
    }
    const wanted = kinds.has(entry.kind) && entry.platform !== null
    let dirs: readonly string[] = []
    if (wanted && entry.locations.length > 0) {
      dirs = entry.locations.map((place) => place.dir)
    } else if (wanted && entry.dirs.length === 1) {
      dirs = entry.dirs
    } else if (wanted && entry.dirs.length === 0 && entry.target.dir !== null) {
      dirs = [entry.target.dir]
    } else if (wanted && into !== undefined) {
      dirs = [into]
    }
    if (dirs.length > 0) put(entry, dirs, entry.platform)
    else if (entry.kind === 'duplicate') duplicates.push(entry)
    else if (wanted) unrouted.push(entry)
  }
  const files: PullFile[] = []
  for (const file of comparison.files) {
    const own = writes.get(`${file.locale}\0${file.dir}`)
    if (!own) continue
    const skipped = [
      ...unwritableKeys(
        file.content,
        Object.keys(own).filter((key) => own[key] !== null),
        file.format,
      ),
    ].sort()
    for (const key of skipped) delete own[key]
    const keys = Object.keys(own)
    if (keys.length === 0 && skipped.length === 0) continue
    files.push({
      locale: file.locale,
      dir: file.dir,
      path: file.path,
      relativePath: file.relativePath,
      created: file.source === null && keys.length > 0,
      set: keys.filter((key) => own[key] !== null),
      removed: keys.filter((key) => own[key] === null),
      skipped,
      output:
        keys.length > 0 ? writeLocaleFile(file.source, own, file.format) : null,
    })
  }
  return { files, unrouted, duplicates }
}

export async function applyPull(files: readonly PullFile[]) {
  for (const file of files) {
    if (file.output === null) continue
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, file.output, 'utf8')
  }
}

/**
 * `planPull`, then, unless `dryRun`, writes the files and records the base:
 * what `localness pull` does, and the editor after it changes one key.
 */
export async function pullLocaleFiles(
  loaded: LoadedConfig,
  comparison: Comparison,
  options: PullOptions & { dryRun?: boolean },
): Promise<PullPlan> {
  const plan = planPull(comparison, options)
  if (!options.dryRun) {
    await applyPull(plan.files)
    await writeBase(loaded, recordPull(comparison, plan.files))
  }
  return plan
}

/**
 * The base once `files` are written: every key in scope whose file text now
 * equals the project's records that text; keys gone from both sides drop out;
 * the rest keep their base, so a later run still sees who changed.
 */
export function recordPull(
  comparison: Comparison,
  files: readonly PullFile[],
): BaseTexts {
  const next: BaseTexts = { ...comparison.base }
  const only = comparison.keys && new Set(comparison.keys)
  for (const locale of comparison.locales) {
    const platform = comparison.platform.texts[locale] ?? {}
    const placed = comparison.placement.locations[locale] ?? {}
    const after = { ...comparison.local[locale] }
    for (const file of files) {
      if (file.locale !== locale || file.output === null) continue
      for (const key of file.set) after[key] = platform[key]!
      for (const key of file.removed) delete after[key]
    }
    const texts = { ...next[locale] }
    const keys = new Set([
      ...Object.keys(after),
      ...Object.keys(platform),
      ...Object.keys(texts).filter((key) => !only || only.has(key)),
    ])
    for (const key of keys) {
      const local = Object.hasOwn(after, key) ? after[key]! : null
      const onPlatform = Object.hasOwn(platform, key)
      if (local !== null && local === platform[key]) texts[key] = local
      else if (local === null && !onPlatform && !placed[key]?.length) {
        delete texts[key]
      }
    }
    if (Object.keys(texts).length > 0) next[locale] = texts
    else delete next[locale]
  }
  return next
}
