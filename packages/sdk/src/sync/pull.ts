import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  unwritableKeys,
  writeLocaleFile,
  type LocaleFileFormat,
} from '@localness/contract/locale-file'
import { requireFiles, type LoadedConfig } from './config'
import type { Comparison, DiffKind } from './diff'
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
]

export interface PullOptions {
  format: LocaleFileFormat
  kinds: readonly DiffKind[]
  /** Also remove keys the platform does not know. */
  prune?: boolean
}

export interface PullFile {
  locale: string
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

/**
 * The project's text for each entry of `kinds`. Keys the project lacks stay
 * unless `prune`; keys without project text are never touched.
 */
export function planPull(
  comparison: Comparison,
  options: PullOptions,
): PullFile[] {
  const kinds = new Set(options.kinds)
  const plans: PullFile[] = []
  for (const file of comparison.files) {
    const writes: Record<string, string | null> = Object.create(null)
    for (const entry of comparison.entries) {
      if (entry.locale !== file.locale) continue
      if (kinds.has(entry.kind) && entry.platform !== null) {
        writes[entry.key] = entry.platform
      } else if (!entry.onPlatform && options.prune) {
        writes[entry.key] = null
      }
    }
    const skipped = [
      ...unwritableKeys(
        file.content,
        Object.keys(writes).filter((key) => writes[key] !== null),
        options.format,
      ),
    ].sort()
    for (const key of skipped) delete writes[key]
    const keys = Object.keys(writes)
    if (keys.length === 0 && skipped.length === 0) continue
    plans.push({
      locale: file.locale,
      path: file.path,
      relativePath: file.relativePath,
      created: file.source === null && keys.length > 0,
      set: keys.filter((key) => writes[key] !== null),
      removed: keys.filter((key) => writes[key] === null),
      skipped,
      output:
        keys.length > 0
          ? writeLocaleFile(file.source, writes, options.format)
          : null,
    })
  }
  return plans
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
  options: Omit<PullOptions, 'format'> & { dryRun?: boolean },
) {
  const files = planPull(comparison, {
    format: requireFiles(loaded).format,
    kinds: options.kinds,
    prune: options.prune,
  })
  if (!options.dryRun) {
    await applyPull(files)
    await writeBase(loaded, recordPull(comparison, files))
  }
  return files
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
    const after = { ...comparison.local[locale] }
    const file = files.find((item) => item.locale === locale && item.output)
    for (const key of file?.set ?? []) after[key] = platform[key]!
    for (const key of file?.removed ?? []) delete after[key]
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
      else if (local === null && !onPlatform) delete texts[key]
    }
    if (Object.keys(texts).length > 0) next[locale] = texts
    else delete next[locale]
  }
  return next
}
