import {
  applyPull,
  compareLocaleFiles,
  planPull,
  requireFiles,
} from '@localness/sdk/sync'
import { list, loadProject, type CliIo, type CliValues } from './shared'

export async function runPull(io: CliIo, values: CliValues) {
  const { client, loaded } = await loadProject(io, values)
  const comparison = await compareLocaleFiles(loaded, client, {
    locales: list(values.locales),
    keys: list(values.keys),
  })
  const prune = values.prune ?? false
  const dryRun = values['dry-run'] ?? false
  const files = planPull(comparison, {
    format: requireFiles(loaded).format,
    prune,
  })
  if (!dryRun) await applyPull(files)
  const written = files.filter((file) => file.output !== null)
  const kept = prune
    ? 0
    : comparison.entries.filter((entry) => entry.kind === 'missing-on-platform')
        .length
  if (values.json) {
    io.stdout(
      `${JSON.stringify(
        {
          dryRun,
          files: files.map(({ output: _, path: __, ...file }) => file),
          kept,
        },
        null,
        2,
      )}\n`,
    )
    return 0
  }
  for (const file of files) {
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
  io.stdout(
    written.length === 0
      ? 'Nothing to write.\n'
      : `${dryRun ? 'Dry run: would write' : 'Wrote'} ${written.length} file${written.length === 1 ? '' : 's'}.\n`,
  )
  if (kept > 0) {
    io.stdout(
      `Kept ${kept} local key${kept === 1 ? '' : 's'} the project does not have; --prune removes them.\n`,
    )
  }
  return 0
}
