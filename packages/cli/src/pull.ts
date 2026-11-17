import {
  FORCED_PULL_KINDS,
  PULL_KINDS,
  applyPull,
  compareLocaleFiles,
  planPull,
  recordPull,
  requireFiles,
  writeBase,
  type Comparison,
  type DiffKind,
  type LoadedConfig,
  type PullFile,
} from '@localness/sdk/sync'
import { countKinds } from './diff'
import { list, loadProject, plural, type CliIo, type CliValues } from './shared'

export interface PullRun {
  files: PullFile[]
  /** Local keys the project lacks, kept because there was no --prune. */
  kept: number
}

/** Writes the files and records the base, unless `dryRun`. */
export async function pullInto(
  loaded: LoadedConfig,
  comparison: Comparison,
  options: { kinds: readonly DiffKind[]; prune: boolean; dryRun: boolean },
): Promise<PullRun> {
  const files = planPull(comparison, {
    format: requireFiles(loaded).format,
    kinds: options.kinds,
    prune: options.prune,
  })
  if (!options.dryRun) {
    await applyPull(files)
    await writeBase(loaded, recordPull(comparison, files))
  }
  const kept = options.prune
    ? 0
    : comparison.entries.filter(
        (entry) => !entry.onPlatform && entry.local !== null,
      ).length
  return { files, kept }
}

export function describePull(io: CliIo, run: PullRun, dryRun: boolean) {
  for (const file of run.files) {
    const parts = [
      file.set.length > 0 && `${file.set.length} set`,
      file.removed.length > 0 && `${file.removed.length} removed`,
      file.skipped.length > 0 && `${file.skipped.length} skipped`,
    ].filter(Boolean)
    io.stdout(
      `${file.relativePath}${file.created ? ' (new)' : ''}: ${parts.join(', ')}\n`,
    )
    for (const key of file.skipped) {
      io.stdout(
        `  skipped ${key}: its path collides with another key in the file\n`,
      )
    }
  }
  const written = run.files.filter((file) => file.output !== null).length
  io.stdout(
    written === 0
      ? 'Nothing to write.\n'
      : `${dryRun ? 'Dry run: would write' : 'Wrote'} ${plural(written, 'file')}.\n`,
  )
  if (run.kept > 0) {
    io.stdout(
      `Kept ${plural(run.kept, 'local key')} the project does not have; --prune removes them.\n`,
    )
  }
}

export function pullJson(run: PullRun, dryRun: boolean) {
  return {
    dryRun,
    files: run.files.map(({ output: _, path: __, ...file }) => file),
    kept: run.kept,
  }
}

export async function runPull(io: CliIo, values: CliValues) {
  const { client, loaded } = await loadProject(io, values)
  const keys = list(values.keys)
  const comparison = await compareLocaleFiles(loaded, client, {
    locales: list(values.locales),
    keys,
  })
  const kinds = keys ? FORCED_PULL_KINDS : PULL_KINDS
  const dryRun = values['dry-run'] ?? false
  const run = await pullInto(loaded, comparison, {
    kinds,
    prune: values.prune ?? false,
    dryRun,
  })
  const left = comparison.entries.filter(
    (entry) =>
      !kinds.includes(entry.kind) &&
      entry.kind !== 'pending-publish' &&
      entry.onPlatform,
  )
  if (values.json) {
    io.stdout(
      `${JSON.stringify(
        {
          ...pullJson(run, dryRun),
          left: left.map(({ locale, key, kind }) => ({ locale, key, kind })),
        },
        null,
        2,
      )}\n`,
    )
    return 0
  }
  describePull(io, run, dryRun)
  if (left.length > 0) {
    io.stdout(
      `Left ${countKinds(left)}; "localness diff" shows them, "pull --keys <key>" takes the project's text.\n`,
    )
  }
  return 0
}
