import type { DiffKind } from '../sync/kinds'

/** The fields of a diff row this review reads. Kept off `sync/diff` so the page typecheck does not pull Node. */
interface ResolveDiff {
  key: string
  locale: string
  kind: DiffKind
  local: string | null
  platform: string | null
  draft: string | null
  base: string | null
  target: {
    dir: string | null
    by: 'existing' | 'namespace' | 'key' | 'fallback' | 'unrouted'
  }
  locations: ReadonlyArray<{
    dir: string
    relativePath: string
    value: string
  }>
  dirs: readonly string[]
}

export type ResolveAction = 'pull' | 'push' | 'prune' | 'skip'

const RESOLVE_ACTIONS = new Set<ResolveAction>([
  'pull',
  'push',
  'prune',
  'skip',
])

/** Kinds the person decides even when the key already has a directory. */
const CHOICE_KINDS = new Set<DiffKind>([
  'conflict',
  'different',
  'duplicate',
  'platform-deleted',
  'local-deleted',
])

export interface ResolveLocation {
  dir: string
  relativePath: string
  /** Absolute path of the locale file, for editor links. */
  path: string
  value: string
}

export interface ResolveCell {
  locale: string
  kind: DiffKind
  /** Which side the diff treats as the change, matching the Local Files view. */
  newer: 'remote' | 'local' | null
  local: string | null
  platform: string | null
  draft: string | null
  base: string | null
  locations: ResolveLocation[]
  /** A `pull` has nowhere to write until the person picks a directory. */
  needsInto: boolean
  allowed: ResolveAction[]
}

export interface ResolveRow {
  /** 1-based, what the person refers to. */
  index: number
  key: string
  cells: ResolveCell[]
}

export interface ResolveEmpty {
  key: string
  locale: string
}

export interface ResolveReviewDoc {
  kind: 'resolve'
  id: string
  createdAt: string
  project: string
  sourceLocale: string
  editor: 'vscode' | 'cursor'
  open?: 'browser' | 'editor'
  /** Config file relative to the working directory; empty when the default is used. */
  config: string
  hasBase: boolean
  /** Configured directories `--into` accepts. */
  dirs: string[]
  empties: ResolveEmpty[]
  rows: ResolveRow[]
}

/** One locale of a row. `into` is the directory a `pull` writes to. */
export interface ResolveDecision {
  action: ResolveAction
  into?: string
}

export interface ResolveResultItem {
  key: string
  locale: string
  kind: DiffKind
  action: ResolveAction
  into?: string
}

export interface ResolveReviewResult {
  id: string
  kind: 'resolve'
  status: 'approved' | 'cancelled'
  items: ResolveResultItem[]
  /** Pull commands first, then push commands. Empty when nothing was chosen. */
  commands: string[]
}

export interface ResolveSourceFile {
  locale: string
  dir: string
  relativePath: string
  path: string
}

/** The part of a comparison the resolve page is built from. */
export interface ResolveSource {
  entries: readonly ResolveDiff[]
  files: readonly ResolveSourceFile[]
  base: unknown
}

/** Actions a difference may take. Anything else is not shown. */
export function resolveActions(
  entry: Pick<ResolveDiff, 'kind' | 'target'>,
): ResolveAction[] {
  if (entry.target.by === 'unrouted' && !CHOICE_KINDS.has(entry.kind)) {
    return ['pull', 'skip']
  }
  switch (entry.kind) {
    case 'conflict':
    case 'different':
      return ['pull', 'push', 'skip']
    case 'duplicate':
      return ['pull', 'skip']
    case 'platform-deleted':
      return ['prune', 'push', 'skip']
    case 'local-deleted':
      return ['pull', 'skip']
    case 'platform-added':
    case 'platform-changed':
    case 'local-added':
    case 'local-changed':
    case 'pending-publish':
    case 'empty':
      return ['skip']
    default: {
      const unhandled: never = entry.kind
      return unhandled
    }
  }
}

/**
 * The side holding the newer text: remote reads locale file → remote, local
 * reads remote → locale file. Null when the diff cannot tell, so neither side
 * is shown as the change.
 */
export function newerSide(kind: DiffKind): 'remote' | 'local' | null {
  switch (kind) {
    case 'platform-added':
    case 'platform-changed':
    case 'platform-deleted':
      return 'remote'
    case 'local-added':
    case 'local-changed':
    case 'local-deleted':
      return 'local'
    case 'different':
    case 'conflict':
    case 'duplicate':
    case 'pending-publish':
    case 'empty':
      return null
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

/**
 * A pull cannot place the key: no file has it, it is not in exactly one
 * directory, and the config names no directory for it.
 */
export function pullNeedsInto(
  entry: Pick<ResolveDiff, 'locations' | 'dirs' | 'target'>,
): boolean {
  if (entry.locations.length > 0) return false
  if (entry.dirs.length === 1) return false
  if (entry.dirs.length === 0 && entry.target.dir !== null) return false
  return true
}

function shown(entry: ResolveDiff) {
  return resolveActions(entry).some((action) => action !== 'skip')
}

/** The keys a person must decide, one row per key, plus empty values to mention. */
export function buildResolveRows(source: ResolveSource): {
  rows: ResolveRow[]
  empties: ResolveEmpty[]
  dirs: string[]
  hasBase: boolean
} {
  const dirs: string[] = []
  for (const file of source.files) {
    if (!dirs.includes(file.dir)) dirs.push(file.dir)
  }
  const empties: ResolveEmpty[] = []
  const byKey = new Map<string, ResolveCell[]>()
  for (const entry of source.entries) {
    if (entry.kind === 'empty') {
      empties.push({ key: entry.key, locale: entry.locale })
      continue
    }
    if (!shown(entry)) continue
    const cells = byKey.get(entry.key) ?? []
    cells.push({
      locale: entry.locale,
      kind: entry.kind,
      newer: newerSide(entry.kind),
      local: entry.local,
      platform: entry.platform,
      draft: entry.draft,
      base: entry.base,
      locations: entry.locations.map((place) => ({
        dir: place.dir,
        relativePath: place.relativePath,
        path:
          source.files.find(
            (file) =>
              file.locale === entry.locale &&
              file.dir === place.dir &&
              file.relativePath === place.relativePath,
          )?.path ?? place.relativePath,
        value: place.value,
      })),
      needsInto: pullNeedsInto(entry),
      allowed: resolveActions(entry),
    })
    byKey.set(entry.key, cells)
  }
  const rows: ResolveRow[] = [...byKey.keys()].sort().map((key, index) => ({
    index: index + 1,
    key,
    cells: byKey.get(key)!.sort((a, b) => a.locale.localeCompare(b.locale)),
  }))
  return {
    rows,
    empties: empties.sort(
      (a, b) => a.key.localeCompare(b.key) || a.locale.localeCompare(b.locale),
    ),
    dirs,
    hasBase: source.base !== null && source.base !== undefined,
  }
}

/** Per row, per locale: why the decision cannot stand, or null. */
export function checkResolveDecisions(
  doc: Pick<ResolveReviewDoc, 'rows' | 'dirs'>,
  decisions: readonly (readonly ResolveDecision[])[],
): (string | null)[][] {
  if (decisions.length !== doc.rows.length) {
    throw new Error('Expected one decision per row.')
  }
  return doc.rows.map((row, index) => {
    const chosen = decisions[index]
    if (!chosen || chosen.length !== row.cells.length) {
      throw new Error(`Expected one decision per locale of ${row.key}.`)
    }
    return row.cells.map((cell, cellIndex) => {
      const decision = chosen[cellIndex]!
      if (!RESOLVE_ACTIONS.has(decision.action)) return 'Unknown action.'
      if (!cell.allowed.includes(decision.action)) {
        return `${decision.action} is not available here.`
      }
      if (decision.action !== 'pull' || !cell.needsInto) return null
      const into = decision.into?.trim() ?? ''
      if (!into) return 'Pick a directory.'
      if (!doc.dirs.includes(into)) {
        return 'That directory is not in the config.'
      }
      return null
    })
  })
}

function shellArg(value: string) {
  return /^[A-Za-z0-9_./:@+,-]+$/.test(value)
    ? value
    : `"${value.replace(/["\\$`]/g, '\\$&')}"`
}

interface CommandGroup {
  action: 'pull' | 'push' | 'prune'
  into?: string
  locales: string[]
  keys: string[]
}

function formatCommand(group: CommandGroup, config: string) {
  const args = ['localness', group.action === 'push' ? 'push' : 'pull']
  if (config) args.push('--config', shellArg(config))
  args.push('--keys', shellArg([...group.keys].sort().join(',')))
  args.push('--locales', shellArg(group.locales.join(',')))
  if (group.into) args.push('--into', shellArg(group.into))
  if (group.action === 'prune') args.push('--prune')
  if (group.action === 'push') args.push('--json')
  return args.join(' ')
}

/**
 * One command per action, directory and locale set: keys that take the same
 * side in the same locales share a command. Pulls come before pushes.
 */
export function resolveCommands(
  doc: Pick<ResolveReviewDoc, 'rows' | 'config'>,
  decisions: readonly (readonly ResolveDecision[])[],
): string[] {
  const perKey = new Map<
    string,
    {
      key: string
      action: 'pull' | 'push' | 'prune'
      into?: string
      locales: string[]
    }
  >()
  doc.rows.forEach((row, index) => {
    row.cells.forEach((cell, cellIndex) => {
      const decision = decisions[index]?.[cellIndex]
      if (!decision || decision.action === 'skip') return
      if (
        decision.action !== 'pull' &&
        decision.action !== 'push' &&
        decision.action !== 'prune'
      ) {
        return
      }
      const into =
        decision.action === 'pull' && cell.needsInto
          ? decision.into?.trim() || undefined
          : undefined
      const id = `${decision.action}\0${into ?? ''}\0${row.key}`
      const found = perKey.get(id)
      if (found) found.locales.push(cell.locale)
      else {
        perKey.set(id, {
          key: row.key,
          action: decision.action,
          into,
          locales: [cell.locale],
        })
      }
    })
  })
  const groups = new Map<string, CommandGroup>()
  for (const item of perKey.values()) {
    const locales = [...item.locales].sort()
    const groupId = `${item.action}\0${item.into ?? ''}\0${locales.join(',')}`
    const group = groups.get(groupId)
    if (group) group.keys.push(item.key)
    else {
      groups.set(groupId, {
        action: item.action,
        into: item.into,
        locales,
        keys: [item.key],
      })
    }
  }
  const order = { pull: 0, prune: 1, push: 2 } as const
  return [...groups.values()]
    .sort(
      (a, b) =>
        order[a.action] - order[b.action] ||
        (a.into ?? '').localeCompare(b.into ?? '') ||
        a.locales.join().localeCompare(b.locales.join()) ||
        [...a.keys]
          .sort()
          .join()
          .localeCompare([...b.keys].sort().join()),
    )
    .map((group) => formatCommand(group, doc.config))
}

export function toResolveResult(
  doc: ResolveReviewDoc,
  status: ResolveReviewResult['status'],
  decisions: readonly (readonly ResolveDecision[])[],
): ResolveReviewResult {
  if (status === 'cancelled') {
    return { id: doc.id, kind: 'resolve', status, items: [], commands: [] }
  }
  const items: ResolveResultItem[] = []
  doc.rows.forEach((row, index) => {
    row.cells.forEach((cell, cellIndex) => {
      const decision = decisions[index]![cellIndex]!
      const item: ResolveResultItem = {
        key: row.key,
        locale: cell.locale,
        kind: cell.kind,
        action: decision.action,
      }
      if (
        decision.action === 'pull' &&
        cell.needsInto &&
        decision.into?.trim()
      ) {
        item.into = decision.into.trim()
      }
      items.push(item)
    })
  })
  return {
    id: doc.id,
    kind: 'resolve',
    status,
    items,
    commands: resolveCommands(doc, decisions),
  }
}
