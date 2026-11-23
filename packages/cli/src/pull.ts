import {
  FORCED_PULL_KINDS,
  PULL_KINDS,
  compareLocaleFiles,
  pullLocaleFiles,
  type Comparison,
  type DiffEntry,
  type DiffKind,
  type LoadedConfig,
  type PullPlan,
} from '@localness/sdk/sync'
import { attention, countKinds, quote } from './diff'
import {
  EXIT_DIFFERENT,
  configField,
  list,
  loadProject,
  plural,
  printWarnings,
  type CliIo,
  type CliValues,
} from './shared'

export interface PullRun extends PullPlan {
  /** Local keys the project lacks, kept because there was no --prune. */
  kept: number
  /** The configured directories `--into` accepts. */
  dirs: string[]
}

/** Writes the files and records the base, unless `dryRun`. */
export async function pullInto(
  loaded: LoadedConfig,
  comparison: Comparison,
  options: {
    kinds: readonly DiffKind[]
    prune: boolean
    dryRun: boolean
    into?: string
  },
): Promise<PullRun> {
  const plan = await pullLocaleFiles(loaded, comparison, options)
  const kept = options.prune
    ? 0
    : comparison.entries.filter(
        (entry) => !entry.onPlatform && entry.local !== null,
      ).length
  const dirs = [...new Set(comparison.files.map((file) => file.dir))]
  return { ...plan, kept, dirs }
}

/** Whether keys wait for a person: the exit code of `pull` and `sync`. */
export function needsPerson(run: PullRun) {
  return run.unrouted.length > 0 || run.duplicates.length > 0
}

function describeKeys(io: CliIo, entries: readonly DiffEntry[]) {
  for (const entry of entries) {
    const where =
      entry.locations.length > 0
        ? entry.locations
            .map((place) => `${place.relativePath} ${quote(place.value)}`)
            .join(', ')
        : `no ${entry.locale} text in ${entry.dirs.join(', ')}`
    io.stdout(
      `  ${entry.key} (${entry.locale}): ${where}; remote ${quote(entry.platform)}\n`,
    )
  }
}

export function describePull(io: CliIo, run: PullRun, dryRun: boolean) {
  for (const file of run.files) {
    const parts = [
      file.set.length > 0 && `${file.set.length} set`,
      file.removed.length > 0 && `${file.removed.length} removed`,
      file.keptInArray.length > 0 && `${file.keptInArray.length} kept in array`,
      file.skipped.length > 0 && `${file.skipped.length} skipped`,
    ].filter(Boolean)
    io.stdout(
      `${file.relativePath}${file.created ? ' (new)' : ''}: ${parts.join(', ')}\n`,
    )
    for (const key of file.skipped) {
      io.stdout(
        `  skipped ${key}: its path collides with another key or an array in the file\n`,
      )
    }
    for (const key of file.keptInArray) {
      io.stdout(
        `  kept ${key}: it is in an array; remove array elements by hand\n`,
      )
    }
  }
  const written = run.files.filter((file) => file.output !== null).length
  io.stdout(
    written === 0
      ? 'Nothing to write.\n'
      : `${dryRun ? 'Dry run: would write' : 'Wrote'} ${plural(written, 'file')}.\n`,
  )
  if (run.unrouted.length > 0) {
    io.stdout(
      `Not written, no directory matches ${plural(run.unrouted.length, 'key')}:\n`,
    )
    for (const entry of run.unrouted) {
      io.stdout(
        `  ${entry.key} (${entry.locale}): remote ${quote(entry.platform)}\n`,
      )
    }
    io.stdout(
      `A person picks the directory (${run.dirs.join(', ')}): "localness pull --keys <key> --into <dir>".\n`,
    )
  }
  if (run.duplicates.length > 0) {
    io.stdout(
      `Not written, ${plural(run.duplicates.length, 'duplicate key')} in several directories:\n`,
    )
    describeKeys(io, run.duplicates)
    io.stdout(
      'A person decides: "localness pull --keys <key>" writes the remote text to every place; add "--into <dir>" for a locale with no place yet; or delete the extra copies by hand.\n',
    )
  }
  if (run.kept > 0) {
    io.stdout(
      `Kept ${plural(run.kept, 'local key')} remote does not have; --prune removes them.\n`,
    )
  }
}

export function pullJson(run: PullRun, dryRun: boolean) {
  return {
    dryRun,
    files: run.files.map(({ output: _, path: __, ...file }) => file),
    kept: run.kept,
    unrouted: run.unrouted.map(attention),
    duplicates: run.duplicates.map(attention),
    dirs: run.dirs,
  }
}

export async function runPull(io: CliIo, values: CliValues) {
  const { client, loaded } = await loadProject(io, values)
  const keys = list(values.keys)
  const comparison = await compareLocaleFiles(loaded, client, {
    locales: list(values.locales),
    keys,
  })
  printWarnings(io, comparison.warnings)
  const kinds = keys ? FORCED_PULL_KINDS : PULL_KINDS
  const dryRun = values['dry-run'] ?? false
  const run = await pullInto(loaded, comparison, {
    kinds,
    prune: values.prune ?? false,
    dryRun,
    into: values.into,
  })
  const left = comparison.entries.filter(
    (entry) =>
      !kinds.includes(entry.kind) &&
      entry.kind !== 'pending-publish' &&
      entry.kind !== 'duplicate' &&
      entry.onPlatform,
  )
  const code = needsPerson(run) ? EXIT_DIFFERENT : 0
  if (values.json) {
    io.stdout(
      `${JSON.stringify(
        {
          config: configField(io, loaded),
          ...pullJson(run, dryRun),
          left: left.map(({ locale, key, kind }) => ({ locale, key, kind })),
        },
        null,
        2,
      )}\n`,
    )
    return code
  }
  describePull(io, run, dryRun)
  if (left.length > 0) {
    io.stdout(
      `Left ${countKinds(left)}; "localness diff" shows them, "pull --keys <key>" takes the remote text.\n`,
    )
  }
  return code
}
