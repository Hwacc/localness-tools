import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  unwritableKeys,
  writeLocaleFile,
  type LocaleFileFormat,
} from '@localness/contract/locale-file'
import type { Comparison } from './diff'

export interface PullOptions {
  format: LocaleFileFormat
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
 * Platform text wins for every key it has text for. Keys only in the file stay
 * unless `prune`; keys without platform text are never touched.
 */
export function planPull(
  comparison: Comparison,
  options: PullOptions,
): PullFile[] {
  const plans: PullFile[] = []
  for (const file of comparison.files) {
    const writes: Record<string, string | null> = Object.create(null)
    for (const entry of comparison.entries) {
      if (entry.locale !== file.locale) continue
      if (entry.kind === 'missing-locally' || entry.kind === 'different') {
        writes[entry.key] = entry.platform
      } else if (entry.kind === 'missing-on-platform' && options.prune) {
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
