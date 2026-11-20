import { normalizeLocaleText } from '@localness/contract/locale-file'
import {
  KEY_VIOLATION_TEXT,
  checkI18nKey,
  isUnnamedKey,
  keyViolationErrors,
  keyViolationWarnings,
  type KeyViolation,
} from '@localness/contract/rules'
import type { LocalnessClient } from '../client'
import { LocalnessError } from '../errors'
import type { DeliveryKeyState } from '../schemas'
import type { LoadedConfig } from './config'
import type { Comparison, DiffEntry, DiffKind } from './diff'
import { platformTextOf } from './platform'
import type { ReleaseRef } from './release'
import {
  MAX_PLAN_KEYS,
  PLAN_TTL_MS,
  newPlanId,
  originOf,
  type BaseTexts,
  type PushBlocked,
  type PushKey,
  type PushPlan,
} from './state'

/** What `push` sends: the local changes. */
export const PUSH_KINDS: readonly DiffKind[] = ['local-added', 'local-changed']
/** `push --keys`: the named keys send the file's text whatever changed. */
export const FORCED_PUSH_KINDS: readonly DiffKind[] = [
  ...PUSH_KINDS,
  'different',
  'conflict',
  'platform-changed',
  'platform-deleted',
]

export interface PlanPushOptions {
  kinds: readonly DiffKind[]
  /** Labels the keys the plan creates; see `resolveRelease`. */
  release?: ReleaseRef | null
  now?: Date
}

/**
 * A key the project lacks is created from the source locale file's text, which
 * the project publishes; every other text becomes a draft that waits for a
 * publish in the web app. A new key whose name breaks the project's key
 * convention is blocked, not created; one that only differs from its suggested
 * style is created and listed in `warnings`. Throws past `MAX_PLAN_KEYS` keys.
 */
export function planPush(
  loaded: LoadedConfig,
  comparison: Comparison,
  options: PlanPushOptions,
): PushPlan {
  const kinds = new Set(options.kinds)
  const source = comparison.sourceLocale
  const keys = new Map<string, PushKey>()
  const blocked: PushBlocked[] = []
  const warnings: PushPlan['warnings'] = []
  const block = (entry: DiffEntry, reason: PushBlocked['reason']) =>
    blocked.push({ locale: entry.locale, key: entry.key, reason })
  const convention = comparison.platform.keyConvention
  const misnamed = new Set<string>()

  for (const entry of comparison.entries) {
    if (entry.kind === 'duplicate' && entry.locations.length > 0) {
      block(entry, 'duplicate')
      continue
    }
    if (!kinds.has(entry.kind) || entry.local === null) continue
    if (isUnnamedKey(entry.key)) {
      block(entry, 'reserved-name')
      continue
    }
    let item = keys.get(entry.key)
    if (!item) {
      let create: PushKey['create'] = null
      if (!entry.onPlatform) {
        if (misnamed.has(entry.key)) continue
        const all = convention ? checkI18nKey(entry.key, convention) : []
        const violations = keyViolationErrors(all)
        if (violations.length > 0) {
          misnamed.add(entry.key)
          blocked.push({
            locale: entry.locale,
            key: entry.key,
            reason: 'key-name',
            violations,
          })
          continue
        }
        const sourceText = comparison.local[source]?.[entry.key]
        if (sourceText === undefined) {
          block(entry, 'no-source-text')
          continue
        }
        create = { sourceText }
        const advice = keyViolationWarnings(all)
        if (advice.length > 0) {
          warnings.push({ key: entry.key, violations: advice })
        }
      }
      item = { key: entry.key, create, locales: {} }
      keys.set(entry.key, item)
    }
    if (item.create && entry.locale === source) continue
    item.locales[entry.locale] = {
      text: entry.local,
      platform: entry.platform,
      draft: entry.draft,
    }
  }

  if (keys.size > MAX_PLAN_KEYS) {
    throw new Error(
      `${keys.size} keys to push; a plan holds at most ${MAX_PLAN_KEYS}. Narrow it with --keys or --locales.`,
    )
  }
  const now = options.now ?? new Date()
  return {
    version: 1,
    id: newPlanId(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
    ...originOf(loaded),
    sourceLocale: source,
    release: options.release ?? null,
    keys: [...keys.values()],
    blocked,
    warnings,
  }
}

/** Why a plan left a key out, for a person. */
export function describeBlocked(item: PushBlocked, sourceLocale: string) {
  switch (item.reason) {
    case 'no-source-text':
      return `the ${sourceLocale} file lacks it; a new key needs its source text`
    case 'reserved-name':
      return '__unnamed_ names are reserved for unnamed drafts'
    case 'duplicate':
      return 'the key is in several directories with different texts; choose one by hand'
    case 'key-name':
      return `breaks the project's key convention: ${describeViolations(item.violations ?? [])}`
  }
}

export function describeViolations(violations: KeyViolation[]) {
  return violations
    .map((violation) => KEY_VIOLATION_TEXT[violation].toLowerCase())
    .join('; ')
}

export interface PlanCheck {
  expired: boolean
  /** Keys whose project text or draft moved since the plan, or that appeared. */
  stale: string[]
  states: Map<string, DeliveryKeyState>
}

/** Re-reads the plan's keys; apply only when nothing is expired or stale. */
export async function checkPlan(
  client: LocalnessClient,
  plan: PushPlan,
  now = new Date(),
): Promise<PlanCheck> {
  const states = new Map<string, DeliveryKeyState>()
  if (now.getTime() > Date.parse(plan.expiresAt)) {
    return { expired: true, stale: [], states }
  }
  const locales = new Set([plan.sourceLocale])
  for (const item of plan.keys) {
    for (const locale of Object.keys(item.locales)) locales.add(locale)
  }
  const result = await client.keyStates({
    locales: [...locales],
    keys: plan.keys.map((item) => item.key),
  })
  for (const state of result.keys) states.set(state.key, state)
  const stale = plan.keys
    .filter((item) => {
      const state = states.get(item.key)
      if (item.create) return state !== undefined
      if (!state) return true
      return Object.entries(item.locales).some(([locale, write]) => {
        const current = state.locales[locale]
        return (
          platformTextOf(current, plan.content) !== write.platform ||
          (normalizeLocaleText(current?.draftText) ?? null) !== write.draft
        )
      })
    })
    .map((item) => item.key)
  return { expired: false, stale, states }
}

export interface PushWritten {
  key: string
  created: boolean
  /** Locales whose draft was written. */
  locales: string[]
}

export interface PushResult {
  written: PushWritten[]
  /** The write that stopped the run; later keys were not tried. */
  failed: { key: string; message: string; conflict: boolean } | null
}

/** Writes key by key, stopping at the first failure. */
export async function applyPush(
  client: LocalnessClient,
  plan: PushPlan,
  check: PlanCheck,
): Promise<PushResult> {
  const written: PushWritten[] = []
  for (const item of plan.keys) {
    const locales = Object.keys(item.locales)
    try {
      if (item.create) {
        await client.createKey({
          key: item.key,
          sourceText: item.create.sourceText,
          releaseId: plan.release?.id,
        })
      }
      if (locales.length > 0) {
        const state = item.create ? undefined : check.states.get(item.key)
        await client.updateKey({
          key: item.key,
          locales: Object.fromEntries(
            Object.entries(item.locales).map(([locale, write]) => [
              locale,
              {
                text: write.text,
                expected: state?.locales[locale]?.draftText ?? '',
              },
            ]),
          ),
        })
      }
      written.push({ key: item.key, created: Boolean(item.create), locales })
    } catch (error) {
      if (!(error instanceof LocalnessError)) throw error
      const detail = error.serverMessage ? `: ${error.serverMessage}` : ''
      return {
        written,
        failed: {
          key: item.key,
          message: `${error.message}${detail}`,
          conflict: error.code === 'conflict',
        },
      }
    }
  }
  return { written, failed: null }
}

/**
 * The base after a push. Only text the project now serves is agreed: a new
 * key's source text, or every draft when the config compares drafts.
 */
export function recordPush(
  base: BaseTexts | null,
  plan: PushPlan,
  result: PushResult,
): BaseTexts {
  const next: BaseTexts = { ...base }
  const agree = (locale: string, key: string, text: string) => {
    next[locale] = { ...next[locale], [key]: text }
  }
  for (const done of result.written) {
    const item = plan.keys.find((candidate) => candidate.key === done.key)!
    if (item.create) agree(plan.sourceLocale, item.key, item.create.sourceText)
    if (plan.content !== 'draft') continue
    for (const locale of done.locales) {
      agree(locale, item.key, item.locales[locale]!.text)
    }
  }
  return next
}
