import type { LocalnessClient } from '../client'
import { requireFiles, type LoadedConfig, type SyncContent } from './config'
import {
  readLocalFiles,
  type LocalKeyLocation,
  type LocalLocaleFile,
  type LocalPlacement,
} from './local'
import { fetchPlatformTexts, type PlatformTexts } from './platform'
import { routeKey, unknownNamespaces, type RouteTarget } from './route'
import { readBase, type BaseTexts } from './state'

/**
 * Where a key's text stands in one locale. Local (L), project (P) and base (B),
 * the text both sides last agreed on:
 * - `platform-added`: P only, no B. Pull.
 * - `platform-changed`: L is B, P moved. Pull.
 * - `platform-deleted`: the project dropped a key that had B. `pull --prune`.
 * - `local-added`: L only: a key or translation the project lacks. Push.
 * - `local-changed`: P is B, L moved. Push.
 * - `local-deleted`: the file dropped a key P still has as B. Reported only.
 * - `different`: L and P differ with no B to tell who changed. Pull by default.
 * - `conflict`: both moved, or P has someone's unpublished draft. Never automatic.
 * - `pending-publish`: L is the project's unpublished draft; nothing to do.
 */
export const DIFF_KINDS = [
  'platform-added',
  'platform-changed',
  'platform-deleted',
  'local-added',
  'local-changed',
  'local-deleted',
  'different',
  'conflict',
  'pending-publish',
  'duplicate',
] as const
export type DiffKind = (typeof DIFF_KINDS)[number]

export interface DiffEntry {
  locale: string
  key: string
  kind: DiffKind
  local: string | null
  platform: string | null
  /** The project's working text; differs from `platform` while unpublished. */
  draft: string | null
  base: string | null
  /** Whether the project has the key at all. */
  onPlatform: boolean
  /** Where a write of this key goes. */
  target: RouteTarget
  /** Where this locale has the key now; several when it is in more than one directory. */
  locations: LocalKeyLocation[]
  /** Every directory holding the key, in any locale. */
  dirs: string[]
}

export interface DiffInput {
  locales: readonly string[]
  local: Record<string, Record<string, string>>
  platform: Pick<PlatformTexts, 'texts' | 'drafts'>
  base: BaseTexts | null
  placement?: LocalPlacement
  route?: (key: string, dirs: string[]) => RouteTarget
}

function classify(
  local: string | null,
  platform: string | null,
  draft: string | null,
  base: string | null,
  onPlatform: boolean,
): DiffKind | undefined {
  if (local === platform) return undefined
  if (local !== null && onPlatform && local === draft) return 'pending-publish'
  if (local !== null && !onPlatform) {
    return base === null ? 'local-added' : 'platform-deleted'
  }
  const foreignDraft = draft !== null && draft !== platform && draft !== local
  if (local !== null && platform === null) {
    return foreignDraft ? 'conflict' : 'local-added'
  }
  if (local === null) {
    if (base === null) return 'platform-added'
    return base === platform ? 'local-deleted' : 'conflict'
  }
  if (base === null) return 'different'
  if (local === base) return 'platform-changed'
  if (platform === base) return foreignDraft ? 'conflict' : 'local-changed'
  return 'conflict'
}

export function diffLocaleTexts(input: DiffInput): DiffEntry[] {
  const entries: DiffEntry[] = []
  for (const locale of input.locales) {
    const localTexts = input.local[locale] ?? {}
    const platformTexts = input.platform.texts[locale] ?? {}
    const drafts = input.platform.drafts[locale] ?? {}
    const baseTexts = input.base?.[locale] ?? {}
    const placed = input.placement?.locations[locale] ?? {}
    const keys = new Set([
      ...Object.keys(localTexts),
      ...Object.keys(platformTexts),
      ...Object.keys(placed),
    ])
    for (const key of [...keys].sort()) {
      const local = Object.hasOwn(localTexts, key) ? localTexts[key]! : null
      const onPlatform = Object.hasOwn(platformTexts, key)
      const platform = onPlatform ? platformTexts[key]! : null
      const draft = onPlatform ? (drafts[key] ?? null) : null
      const base = Object.hasOwn(baseTexts, key) ? baseTexts[key]! : null
      const locations = placed[key] ?? []
      const dirs = input.placement?.dirs[key] ?? []
      const split =
        dirs.length > 1 &&
        (locations.some((place) => place.value !== locations[0]!.value) ||
          (locations.length === 0 && platform !== null))
      const kind = split
        ? 'duplicate'
        : classify(local, platform, draft, base, onPlatform)
      if (kind) {
        entries.push({
          locale,
          key,
          kind,
          local,
          platform,
          draft,
          base,
          onPlatform,
          target: input.route?.(key, dirs) ?? {
            dir: dirs[0] ?? null,
            by: dirs.length > 0 ? 'existing' : 'unrouted',
          },
          locations,
          dirs,
        })
      }
    }
  }
  return entries
}

export interface CompareOptions {
  /** Overrides the config's `locales`. */
  locales?: readonly string[]
  /** Only these key names, on both sides. */
  keys?: readonly string[]
}

export interface Comparison {
  sourceLocale: string
  content: SyncContent
  locales: string[]
  /** Only these keys were compared; null for all. */
  keys: string[] | null
  /** The requested locales' files, one per configured directory. */
  files: LocalLocaleFile[]
  /** Where each key is written locally. */
  placement: LocalPlacement
  /** Config problems worth telling the person; nothing stops. */
  warnings: string[]
  /** Per locale, the file's texts in scope; also the source locale's. */
  local: Record<string, Record<string, string>>
  platform: PlatformTexts
  base: BaseTexts | null
  entries: DiffEntry[]
}

export async function compareLocaleFiles(
  loaded: LoadedConfig,
  client: LocalnessClient,
  options: CompareOptions = {},
): Promise<Comparison> {
  const [platform, base] = await Promise.all([
    fetchPlatformTexts(client, {
      locales: options.locales ?? loaded.config.locales,
      keys: options.keys,
      content: loaded.config.content,
    }),
    readBase(loaded),
  ])
  const read = await readLocalFiles(loaded, Object.keys(platform.texts), {
    placementLocales: platform.projectLocales,
  })
  const only = options.keys && new Set(options.keys)
  const inScope = <T>(record: Record<string, T>) =>
    only
      ? Object.fromEntries(
          Object.entries(record).filter(([key]) => only.has(key)),
        )
      : { ...record }
  const local = Object.fromEntries(
    read.locales.map((file) => [file.locale, inScope(file.entries)]),
  )
  const placement: LocalPlacement = {
    dirs: read.placement.dirs,
    locations: Object.fromEntries(
      Object.entries(read.placement.locations).map(([locale, places]) => [
        locale,
        inScope(places),
      ]),
    ),
  }
  const configured = requireFiles(loaded)
  const keyPrefix = platform.keyConvention?.prefix ?? ''
  const unknown = unknownNamespaces(configured, platform.namespaces)
  return {
    sourceLocale: platform.sourceLocale,
    content: loaded.config.content,
    locales: platform.locales,
    keys: options.keys ? [...options.keys] : null,
    files: read.files.filter((file) => platform.locales.includes(file.locale)),
    placement,
    warnings: unknown.map(
      (name) =>
        `files match.namespace "${name}" is not a namespace of the project (it has: ${platform.namespaces.join(', ') || 'none'}).`,
    ),
    local,
    platform,
    base,
    entries: diffLocaleTexts({
      locales: platform.locales,
      local,
      platform,
      base,
      placement,
      route: (key, dirs) =>
        routeKey(key, configured, {
          namespaces: platform.namespaces,
          keyPrefix,
          existing: dirs,
        }),
    }),
  }
}
