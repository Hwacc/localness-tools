import {
  applyPush,
  checkPlan,
  deletePlan,
  listPlans,
  loadPlan,
  prunePlans,
  readBase,
  recordPush,
  writeBase,
} from '@localness/sdk/sync'
import {
  EXIT_ERROR,
  loadProject,
  plural,
  type CliIo,
  type CliValues,
} from './shared'

export async function runApply(
  io: CliIo,
  values: CliValues,
  id: string | undefined,
) {
  const { client, loaded } = await loadProject(io, values)
  if (!id) {
    await prunePlans(loaded)
    const plans = await listPlans(loaded)
    if (values.json) {
      io.stdout(
        `${JSON.stringify(
          plans.map((plan) => ({
            id: plan.id,
            createdAt: plan.createdAt,
            expiresAt: plan.expiresAt,
            keys: plan.keys.length,
          })),
          null,
          2,
        )}\n`,
      )
    } else if (plans.length === 0) {
      io.stdout('No plans; "localness push" makes one.\n')
    } else {
      for (const plan of plans) {
        io.stdout(
          `${plan.id}  ${plural(plan.keys.length, 'key')}, expires ${plan.expiresAt}\n`,
        )
      }
      io.stdout('Run "localness apply <id>" to write one.\n')
    }
    return EXIT_ERROR
  }

  const plan = await loadPlan(loaded, id)
  const check = await checkPlan(client, plan)
  if (check.expired || check.stale.length > 0) {
    await deletePlan(loaded, id)
    throw new Error(
      check.expired
        ? `Plan ${id} expired; run "localness push" again.`
        : `The project changed since plan ${id} was made (${check.stale.join(', ')}); nothing was written. Run "localness push" again.`,
    )
  }
  const result = await applyPush(client, plan, check)
  await deletePlan(loaded, id)
  await writeBase(loaded, recordPush(await readBase(loaded), plan, result))

  if (values.json) {
    io.stdout(`${JSON.stringify({ id, ...result }, null, 2)}\n`)
  } else {
    for (const done of result.written) {
      const parts = [
        done.created && `created, ${plan.sourceLocale} published`,
        done.locales.length > 0 && `drafts for ${done.locales.join(', ')}`,
      ].filter(Boolean)
      io.stdout(`  ${done.key}: ${parts.join('; ')}\n`)
    }
    io.stdout(
      `Wrote ${plural(result.written.length, 'key')} of ${plan.keys.length}.\n`,
    )
    if (result.failed) {
      io.stdout(
        `Stopped at ${result.failed.key}: ${result.failed.message}${result.failed.conflict ? ' Someone changed it meanwhile; run "localness diff".' : ''}\n`,
      )
    } else if (result.written.some((done) => done.locales.length > 0)) {
      io.stdout('Drafts reach the bundle once published in the web app.\n')
    }
  }
  return result.failed ? EXIT_ERROR : 0
}
