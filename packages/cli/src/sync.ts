import {
  PUSH_KINDS,
  SYNC_PULL_KINDS,
  compareLocaleFiles,
} from '@localness/sdk/sync'
import { describePull, needsPerson, pullInto, pullJson } from './pull'
import { describePush, planPushFrom, pushJson } from './push'
import {
  EXIT_DIFFERENT,
  list,
  loadProject,
  printWarnings,
  type CliIo,
  type CliValues,
} from './shared'

/** Pulls the project's changes and plans pushing local ones; `apply` stays separate. */
export async function runSync(io: CliIo, values: CliValues) {
  const { client, loaded } = await loadProject(io, values)
  const comparison = await compareLocaleFiles(loaded, client, {
    locales: list(values.locales),
    keys: list(values.keys),
  })
  printWarnings(io, comparison.warnings)
  const dryRun = values['dry-run'] ?? false
  const pulled = await pullInto(loaded, comparison, {
    kinds: SYNC_PULL_KINDS,
    prune: false,
    dryRun,
    into: values.into,
  })
  const pushed = await planPushFrom(io, loaded, client, comparison, {
    kinds: PUSH_KINDS,
    dryRun,
  })
  if (values.json) {
    io.stdout(
      `${JSON.stringify(
        { pull: pullJson(pulled, dryRun), push: pushJson(pushed) },
        null,
        2,
      )}\n`,
    )
  } else {
    describePull(io, pulled, dryRun)
    describePush(io, pushed, dryRun)
  }
  return needsPerson(pulled) ? EXIT_DIFFERENT : 0
}
