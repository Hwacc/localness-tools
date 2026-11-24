/** One locale a plan would write. `from` is the remote text it replaces. */
export interface PlanLocaleChange {
  locale: string
  /** `draft` when the project has one, otherwise the published text. */
  from: string | null
  platform: string | null
  draft: string | null
  /** The locale file's text, written as a draft. */
  text: string
}

export interface PlanKeyRow {
  /** 1-based within the plan. */
  index: number
  key: string
  /** Set when the project lacks the key: created and published. */
  create: { sourceText: string } | null
  locales: PlanLocaleChange[]
  /** Set when a new key misses the suggested style. It is still created. */
  warning: string | null
  /** The project moved this key after the plan was made. */
  stale: boolean
}

export interface PlanBlockedRow {
  key: string
  locale: string
  text: string
}

export interface PlanSection {
  id: string
  expiresAt: string
  release: string | null
  keys: PlanKeyRow[]
  /** Shown only. A blocked key is never written. */
  blocked: PlanBlockedRow[]
  stale: string[]
}

export interface PlanReviewDoc {
  kind: 'plan'
  id: string
  createdAt: string
  project: string
  sourceLocale: string
  editor: 'vscode' | 'cursor'
  open?: 'browser' | 'editor'
  /** Config file relative to the working directory; empty when the default is used. */
  config: string
  plans: PlanSection[]
}

/** One plan. `locales` lines up with the section's locale list. */
export interface PlanKeyDecision {
  include: boolean
  locales: boolean[]
}

export interface PlanDecision {
  approve: boolean
  keys: PlanKeyDecision[]
}

export interface PlanLeft {
  key: string
  locales: string[]
}

export interface PlanOutcome {
  /** The plan the page showed. */
  planId: string
  /** The plan to apply. Null when the plan was rejected or emptied. */
  applyId: string | null
  /** Keys the applied plan still holds. */
  keys: number
  /** Keys or locales the person left out. */
  left: PlanLeft[]
}

export interface PlanReviewResult {
  id: string
  kind: 'plan'
  status: 'approved' | 'cancelled'
  plans: PlanOutcome[]
  /** `localness apply` commands, in plan order. Empty when nothing was approved. */
  commands: string[]
}
