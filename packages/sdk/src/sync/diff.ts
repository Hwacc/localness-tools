import type { LocalnessClient } from '../client'
import { requireFiles, type LoadedConfig, type SyncContent } from './config'
import {
  readLocalFiles,
  strayLocaleFileWarnings,
  type LocalKeyLocation,
  type LocalLocaleFile,
  type LocalPlacement,
} from './local'
import { fetchPlatformTexts, type PlatformTexts } from './platform'
import { routeKey, unknownNamespaces, type RouteTarget } from './route'
import { readBase, type BaseTexts } from './state'
import { DIFF_KINDS, type DiffKind } from './kinds'

export { DIFF_KINDS, type DiffKind }

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
  empty: boolean,
): DiffKind | undefined {
  if (local === platform) return empty && local === null ? 'empty' : undefined
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
    const emptyKeys = new Set(input.placement?.empties[locale] ?? [])
    const keys = new Set([
      ...Object.keys(localTexts),
      ...Object.keys(platformTexts),
      ...Object.keys(placed),
      ...emptyKeys,
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
        : classify(local, platform, draft, base, onPlatform, emptyKeys.has(key))
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
  const [read, fileWarnings] = await Promise.all([
    readLocalFiles(loaded, Object.keys(platform.texts), {
      placementLocales: platform.projectLocales,
    }),
    strayLocaleFileWarnings(loaded, platform.projectLocales),
  ])
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
    empties: Object.fromEntries(
      Object.entries(read.placement.empties).map(([locale, keys]) => [
        locale,
        only ? keys.filter((key) => only.has(key)) : keys,
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
    warnings: [
      ...unknown.map(
        (name) =>
          `files match.namespace "${name}" is not a namespace of the project (it has: ${platform.namespaces.join(', ') || 'none'}).`,
      ),
      ...fileWarnings,
    ],
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
