import type { LoadedConfig } from '../sync/config'
import { describeBlocked, describeViolations } from '../sync/push'
import {
  deletePlan,
  loadPlan,
  newPlanId,
  savePlan,
  type PushKey,
  type PushPlan,
} from '../sync/state'
import type {
  PlanDecision,
  PlanKeyRow,
  PlanLeft,
  PlanOutcome,
  PlanReviewDoc,
  PlanReviewResult,
  PlanSection,
} from './plan-doc'
import { shellArg } from './shell'

export type {
  PlanBlockedRow,
  PlanDecision,
  PlanKeyDecision,
  PlanKeyRow,
  PlanLeft,
  PlanLocaleChange,
  PlanOutcome,
  PlanReviewDoc,
  PlanReviewResult,
  PlanSection,
} from './plan-doc'

const NOTHING = 'Nothing selected; cancel instead.'

/** The page's view of one saved plan. `check.stale` marks keys the project moved. */
export function buildPlanSection(
  plan: PushPlan,
  check: { stale: readonly string[] },
): PlanSection {
  const stale = new Set(check.stale)
  const warnings = new Map(
    plan.warnings.map((warning) => [
      warning.key,
      describeViolations(warning.violations),
    ]),
  )
  const keys: PlanKeyRow[] = plan.keys.map((item, index) => ({
    index: index + 1,
    key: item.key,
    create: item.create,
    locales: Object.entries(item.locales).map(([locale, write]) => ({
      locale,
      from: write.draft ?? write.platform,
      platform: write.platform,
      draft: write.draft,
      text: write.text,
    })),
    warning: warnings.get(item.key) ?? null,
    stale: stale.has(item.key),
  }))
  return {
    id: plan.id,
    expiresAt: plan.expiresAt,
    release: plan.release?.name ?? null,
    keys,
    blocked: plan.blocked.map((item) => ({
      key: item.key,
      locale: item.locale,
      text: describeBlocked(item, plan.sourceLocale),
    })),
    stale: plan.keys
      .map((item) => item.key)
      .filter((key) => stale.has(key)),
  }
}

function localeNames(item: PushKey) {
  return Object.keys(item.locales)
}

function kept(
  item: PushKey,
  chosen: PlanDecision['keys'][number] | undefined,
) {
  const locales: PushKey['locales'] = {}
  if (!chosen?.include) return { keep: false, locales }
  for (const [index, locale] of localeNames(item).entries()) {
    if (chosen.locales[index]) locales[locale] = item.locales[locale]!
  }
  if (!item.create && Object.keys(locales).length === 0) {
    return { keep: false, locales }
  }
  return { keep: true, locales }
}

function sameContent(plan: PushPlan, keys: readonly PushKey[]) {
  if (plan.keys.length !== keys.length) return false
  return plan.keys.every((item, index) => {
    const other = keys[index]!
    return (
      item.key === other.key &&
      localeNames(item).length === localeNames(other).length
    )
  })
}

/**
 * The plan reduced to what the person kept. The same object when nothing was
 * removed, null when the plan was rejected or nothing in it remains.
 * A new key stays when its source text stays, even with every locale removed.
 */
export function narrowPlan(
  plan: PushPlan,
  decision: PlanDecision,
): PushPlan | null {
  if (!decision.approve) return null
  const keys: PushKey[] = []
  for (const [index, item] of plan.keys.entries()) {
    const choice = kept(item, decision.keys[index])
    if (!choice.keep) continue
    keys.push({ key: item.key, create: item.create, locales: choice.locales })
  }
  if (keys.length === 0) return null
  if (sameContent(plan, keys)) return plan
  const names = new Set(keys.map((item) => item.key))
  return {
    ...plan,
    keys,
    warnings: plan.warnings.filter((warning) => names.has(warning.key)),
  }
}

/** Why a decision cannot stand, one entry per plan, or null. */
export function checkPlanDecisions(
  doc: Pick<PlanReviewDoc, 'plans'>,
  decisions: readonly PlanDecision[],
): (string | null)[] {
  if (decisions.length !== doc.plans.length) {
    throw new Error('Expected one decision per plan.')
  }
  let selected = false
  const errors = doc.plans.map((section, index) => {
    const decision = decisions[index]!
    if (decision.keys.length !== section.keys.length) {
      throw new Error(`Expected one decision per key of ${section.id}.`)
    }
    for (const [keyIndex, key] of section.keys.entries()) {
      const chosen = decision.keys[keyIndex]!
      if (chosen.locales.length !== key.locales.length) {
        throw new Error(
          `Expected one decision per locale of ${key.key} in ${section.id}.`,
        )
      }
      if (!decision.approve || !chosen.include) continue
      if (key.create || chosen.locales.some(Boolean)) selected = true
    }
    return null
  })
  if (!selected) return errors.map(() => NOTHING)
  return errors
}

function leftOf(plan: PushPlan, decision: PlanDecision): PlanLeft[] {
  if (!decision.approve) {
    return plan.keys.map((item) => ({
      key: item.key,
      locales: localeNames(item),
    }))
  }
  const left: PlanLeft[] = []
  for (const [index, item] of plan.keys.entries()) {
    const chosen = decision.keys[index]
    const names = localeNames(item)
    if (!chosen?.include) {
      left.push({ key: item.key, locales: names })
      continue
    }
    const dropped = names.filter((_, localeIndex) => !chosen.locales[localeIndex])
    if (dropped.length > 0) left.push({ key: item.key, locales: dropped })
  }
  return left
}

function applyCommand(id: string, config: string) {
  const args = ['localness', 'apply', shellArg(id)]
  if (config) args.push('--config', shellArg(config))
  args.push('--json')
  return args.join(' ')
}

/**
 * Writes what the person approved. A narrowed plan is saved under a new id
 * and the original is deleted. A plan left whole keeps its id. A rejected
 * plan is deleted. Cancelling never calls this.
 */
export async function settlePlans(
  loaded: LoadedConfig,
  doc: PlanReviewDoc,
  decisions: readonly PlanDecision[],
): Promise<PlanReviewResult> {
  const errors = checkPlanDecisions(doc, decisions)
  if (errors.some(Boolean)) {
    throw new Error(errors.find(Boolean) ?? NOTHING)
  }
  // Every plan must still be on disk before any is replaced or deleted.
  const stored = await Promise.all(
    doc.plans.map((section) => loadPlan(loaded, section.id)),
  )
  const plans: PlanOutcome[] = []
  const commands: string[] = []
  for (const [index, plan] of stored.entries()) {
    const decision = decisions[index]!
    const narrowed = narrowPlan(plan, decision)
    const left = leftOf(plan, decision)
    if (!narrowed) {
      await deletePlan(loaded, plan.id)
      plans.push({ planId: plan.id, applyId: null, keys: 0, left })
      continue
    }
    const saved =
      narrowed === plan ? plan : { ...narrowed, id: newPlanId() }
    if (saved !== plan) {
      await savePlan(loaded, saved)
      await deletePlan(loaded, plan.id)
    }
    plans.push({
      planId: plan.id,
      applyId: saved.id,
      keys: saved.keys.length,
      left,
    })
    commands.push(applyCommand(saved.id, doc.config))
  }
  return { id: doc.id, kind: 'plan', status: 'approved', plans, commands }
}

export function toPlanCancelled(doc: Pick<PlanReviewDoc, 'id'>): PlanReviewResult {
  return {
    id: doc.id,
    kind: 'plan',
    status: 'cancelled',
    plans: [],
    commands: [],
  }
}
