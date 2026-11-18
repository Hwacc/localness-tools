import { relative } from 'node:path'
import {
  FORCED_PUSH_KINDS,
  PUSH_KINDS,
  compareLocaleFiles,
  planPush,
  prunePlans,
  resolveRelease,
  savePlan,
  type Comparison,
  type DiffKind,
  type LoadedConfig,
  type PushBlocked,
  type PushPlan,
} from '@localness/sdk/sync'
import type { LocalnessClient } from '@localness/sdk'
import { countKinds, quote } from './diff'
import { list, loadProject, plural, type CliIo, type CliValues } from './shared'

/** Never pushed without naming the key: either side may be the newer one. */
const NEEDS_KEYS: readonly DiffKind[] = ['different', 'conflict']

const BLOCK_REASONS: Record<PushBlocked['reason'], (source: string) => string> =
  {
    'no-source-text': (source) =>
      `the ${source} file lacks it; a new key needs its source text`,
    'reserved-name': () => '__unnamed_ names are reserved for unnamed drafts',
  }

export interface PlannedPush {
  plan: PushPlan
  /** Where it was saved, relative to the working directory; null when empty or a dry run. */
  path: string | null
  leftOut: Comparison['entries']
}

export async function planPushFrom(
  io: CliIo,
  loaded: LoadedConfig,
  client: LocalnessClient,
  comparison: Comparison,
  options: { kinds: readonly DiffKind[]; dryRun: boolean },
): Promise<PlannedPush> {
  const plan = planPush(loaded, comparison, { kinds: options.kinds })
  // Only a plan that creates keys needs the release, so a stale name never blocks updates.
  if (plan.keys.some((item) => item.create)) {
    plan.release = await resolveRelease(loaded, client)
  }
  if (!options.dryRun) await prunePlans(loaded)
  const path =
    plan.keys.length > 0 && !options.dryRun
      ? relative(io.cwd, await savePlan(loaded, plan))
      : null
  const leftOut = comparison.entries.filter(
    (entry) =>
      NEEDS_KEYS.includes(entry.kind) && !options.kinds.includes(entry.kind),
  )
  return { plan, path, leftOut }
}

export function pushJson({ plan, path, leftOut }: PlannedPush) {
  return {
    id: path ? plan.id : null,
    path,
    expiresAt: path ? plan.expiresAt : null,
    sourceLocale: plan.sourceLocale,
    release: plan.release?.name ?? null,
    keys: plan.keys,
    blocked: plan.blocked,
    leftOut: leftOut.map(({ locale, key, kind }) => ({ locale, key, kind })),
  }
}

export function describePush(io: CliIo, planned: PlannedPush, dryRun: boolean) {
  const { plan, path, leftOut } = planned
  if (plan.keys.length === 0) {
    io.stdout('Nothing to push.\n')
  } else {
    const created = plan.keys.filter((item) => item.create).length
    io.stdout(
      `${dryRun ? 'Would plan' : `Plan ${plan.id}`}: ${plural(plan.keys.length, 'key')}${created > 0 ? ` (${created} new${plan.release ? `, labelled ${plan.release.name}` : ''})` : ''}\n`,
    )
    for (const item of plan.keys) {
      io.stdout(`  ${item.create ? 'create' : 'update'} ${item.key}\n`)
      if (item.create) {
        io.stdout(
          `    ${plan.sourceLocale}: ${quote(item.create.sourceText)} (published)\n`,
        )
      }
      for (const [locale, write] of Object.entries(item.locales)) {
        const from = write.draft ?? write.platform
        io.stdout(
          `    ${locale}: ${from === null ? '' : `${quote(from)} → `}${quote(write.text)} (draft)\n`,
        )
      }
    }
  }
  if (plan.blocked.length > 0) {
    io.stdout('Blocked:\n')
    for (const item of plan.blocked) {
      io.stdout(
        `  ${item.key} (${item.locale}): ${BLOCK_REASONS[item.reason](plan.sourceLocale)}\n`,
      )
    }
  }
  if (leftOut.length > 0) {
    io.stdout(
      `Left out ${countKinds(leftOut)}; "push --keys <key>" sends the local text.\n`,
    )
  }
  if (path) {
    io.stdout(
      `Saved ${path}, valid for an hour. "localness apply ${plan.id}" writes it; drafts wait for a publish in the web app.\n`,
    )
  }
}

export async function runPush(io: CliIo, values: CliValues) {
  const { client, loaded } = await loadProject(io, values)
  const keys = list(values.keys)
  const comparison = await compareLocaleFiles(loaded, client, {
    locales: list(values.locales),
    keys,
  })
  const dryRun = values['dry-run'] ?? false
  const planned = await planPushFrom(io, loaded, client, comparison, {
    kinds: keys ? FORCED_PUSH_KINDS : PUSH_KINDS,
    dryRun,
  })
  if (values.json) {
    io.stdout(`${JSON.stringify(pushJson(planned), null, 2)}\n`)
  } else {
    describePush(io, planned, dryRun)
  }
  return 0
}
