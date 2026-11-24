import {
  KEY_VIOLATION_TEXT,
  checkI18nKey,
  keyViolationErrors,
  keyViolationWarnings,
  type KeyViolation,
} from '@localness/contract/rules'
import type { DeliveryKeyConvention } from '../schemas'
import type { PlanReviewDoc } from './plan-doc'
import type { ResolveReviewDoc } from './resolve'

const UNNAMED_PREFIX = '__unnamed_'

/** One hardcoded text as the agent found it. `key` is its proposed new name. */
export interface ReviewItemInput {
  text: string
  file?: string
  line?: number
  key?: string
}

export interface ReviewCandidate {
  key: string
  sourceText: string
  source: 'platform' | 'local'
  draft?: boolean
}

export interface ReviewRow {
  /** 1-based, what the person refers to. */
  index: number
  text: string
  file?: string
  line?: number
  /** Absolute, for editor links. */
  path?: string
  /** The source line the text sits on, trimmed. */
  snippet?: string
  candidates: ReviewCandidate[]
  suggestion: string
}

export type ReviewAction = 'reuse' | 'create' | 'skip'

export interface ReviewDecision {
  action: ReviewAction
  key: string
}

export interface ExtractReviewDoc {
  /** Absent on reviews written before resolve pages existed. */
  kind?: 'extract'
  id: string
  createdAt: string
  project: string
  sourceLocale: string
  /** URL scheme that opens files in the person's editor. */
  editor: 'vscode' | 'cursor'
  /** Where it is shown; only `editor` reviews are claimed by the extension. */
  open?: 'browser' | 'editor'
  convention: DeliveryKeyConvention | null
  namespaces: string[]
  rows: ReviewRow[]
}

export type ReviewDoc = ExtractReviewDoc | ResolveReviewDoc | PlanReviewDoc

export type ReviewKind = 'extract' | 'resolve' | 'plan'

/** A doc written before kinds existed has no `kind` and is an extract review. */
export function reviewKindOf(doc: ReviewDoc): ReviewKind {
  switch (doc.kind) {
    case 'resolve':
      return 'resolve'
    case 'plan':
      return 'plan'
    case 'extract':
    case undefined:
      return 'extract'
    default: {
      const unhandled: never = doc
      return unhandled
    }
  }
}

/** How many rows the page lists: texts, diff keys, or plan keys. */
export function reviewSize(doc: ReviewDoc): number {
  switch (doc.kind) {
    case 'resolve':
      return doc.rows.length
    case 'plan':
      return doc.plans.reduce((sum, plan) => sum + plan.keys.length, 0)
    case 'extract':
    case undefined:
      return doc.rows.length
    default: {
      const unhandled: never = doc
      return unhandled
    }
  }
}

export interface ReviewResultItem {
  index: number
  text: string
  file?: string
  line?: number
  action: ReviewAction
  key?: string
  /** For `reuse`: where the key lives; a `local` key is not pushed yet. */
  source?: ReviewCandidate['source']
}

export interface ReviewResult {
  id: string
  status: 'approved' | 'cancelled'
  items: ReviewResultItem[]
}

/** Accepts `{ items: [...] }` or a bare array. */
export function parseReviewInput(value: unknown): ReviewItemInput[] {
  const items = Array.isArray(value)
    ? value
    : (value as { items?: unknown } | null)?.items
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('The review file needs a non-empty "items" array.')
  }
  return items.map((item: unknown, index) => {
    const row = item as Record<string, unknown> | null
    if (!row || typeof row.text !== 'string' || !row.text.trim()) {
      throw new Error(`items[${index}] needs a non-empty "text".`)
    }
    const optional = <T>(name: string, type: 'string' | 'number') => {
      const field = row[name]
      if (field === undefined || field === null) return undefined
      if (typeof field !== type) {
        throw new Error(`items[${index}].${name} must be a ${type}.`)
      }
      return field as T
    }
    return {
      text: row.text,
      file: optional<string>('file', 'string'),
      line: optional<number>('line', 'number'),
      key: optional<string>('key', 'string'),
    }
  })
}

/** One candidate: reuse it. Several: the person picks. None: a new key. */
export function initialDecision(row: ReviewRow): ReviewDecision {
  if (row.candidates.length === 1) {
    return { action: 'reuse', key: row.candidates[0]!.key }
  }
  if (row.candidates.length > 1) return { action: 'reuse', key: '' }
  return { action: 'create', key: row.suggestion }
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

function violationsOf(
  doc: ExtractReviewDoc,
  name: string,
  level: (all: KeyViolation[]) => KeyViolation[],
  lead = '',
) {
  const violations = doc.convention
    ? level(checkI18nKey(name, doc.convention))
    : []
  return violations.length > 0
    ? lead +
        violations.map((violation) => KEY_VIOLATION_TEXT[violation]).join('; ')
    : null
}

/** Names a decision would bring in that will push; null when none. */
function newName(row: ReviewRow, decision: ReviewDecision) {
  const name = decision.key.trim()
  if (!name) return null
  if (decision.action === 'create') return name
  const candidate = row.candidates.find((hit) => hit.key === name)
  return decision.action === 'reuse' && candidate?.source === 'local'
    ? name
    : null
}

/**
 * Per row, how a name that will be pushed differs from the convention's
 * suggestions, or null. Advice only: it never blocks approval.
 */
export function decisionWarnings(
  doc: ExtractReviewDoc,
  decisions: readonly ReviewDecision[],
): (string | null)[] {
  return decisions.map((decision, index) => {
    const name = newName(doc.rows[index]!, decision)
    return name
      ? violationsOf(
          doc,
          name,
          keyViolationWarnings,
          'Off the suggested key style: ',
        )
      : null
  })
}

/**
 * Per row, why the decision cannot stand, or null. `taken` returns the new
 * names that already exist on the project or in the source-locale file.
 */
export async function checkDecisions(
  doc: ExtractReviewDoc,
  decisions: readonly ReviewDecision[],
  taken: (names: string[]) => Promise<Set<string>>,
): Promise<(string | null)[]> {
  if (decisions.length !== doc.rows.length) {
    throw new Error('Expected one decision per row.')
  }
  // Two rows may share a new name only when they hold the same text.
  const created = new Map<string, string | null>()
  for (const [index, decision] of decisions.entries()) {
    const name = decision.key.trim()
    if (decision.action !== 'create' || !name) continue
    const text = normalize(doc.rows[index]!.text)
    if (!created.has(name)) created.set(name, text)
    else if (created.get(name) !== text) created.set(name, null)
  }
  const existing = await taken([...created.keys()])
  return decisions.map((decision, index) => {
    const row = doc.rows[index]!
    const name = decision.key.trim()
    switch (decision.action) {
      case 'skip':
        return null
      case 'reuse':
        if (!name) return 'Pick one of the matching keys.'
        const candidate = row.candidates.find((hit) => hit.key === name)
        if (!candidate) return `${name} does not hold this text.`
        // Not pushed yet, so push would still block it.
        return candidate.source === 'local'
          ? violationsOf(
              doc,
              name,
              keyViolationErrors,
              'Push will block this local key: ',
            )
          : null
      case 'create': {
        if (!name) return 'Name the new key.'
        if (/[\s'"`]/.test(name)) return 'No spaces or quotes in key names.'
        if (name.startsWith(UNNAMED_PREFIX)) {
          return `${UNNAMED_PREFIX} is reserved for unnamed keys.`
        }
        if (existing.has(name)) return `${name} already exists.`
        if (created.get(name) === null) {
          return `${name} is also used for a different text.`
        }
        return violationsOf(doc, name, keyViolationErrors)
      }
      default:
        return 'Unknown action.'
    }
  })
}

export function toResult(
  doc: ExtractReviewDoc,
  status: ReviewResult['status'],
  decisions: readonly ReviewDecision[],
): ReviewResult {
  if (status === 'cancelled') return { id: doc.id, status, items: [] }
  return {
    id: doc.id,
    status,
    items: doc.rows.map((row, index) => {
      const { action, key } = decisions[index]!
      const name = key.trim()
      const item: ReviewResultItem = {
        index: row.index,
        text: row.text,
        file: row.file,
        line: row.line,
        action,
      }
      if (action !== 'skip') item.key = name
      if (action === 'reuse') {
        item.source = row.candidates.find(
          (candidate) => candidate.key === name,
        )?.source
      }
      return item
    }),
  }
}
