import {
  findRelease,
  type DeliveryKeyConvention,
  type DeliveryKeyState,
  type DeliveryMeta,
  type DeliveryProjectRef,
  type KeyStatesResult,
  type ProjectRelease,
} from '@localness/sdk'
import type { ReleaseRef } from '@localness/sdk/sync'
import { buildIndex } from './keys'

export interface ResolvedLocales {
  sourceLocale: string
  displayLocale: string
  available: string[]
  /** Locales to request: source and display, deduplicated. */
  fetch: string[]
}

export function resolveLocales(
  meta: DeliveryMeta,
  configured: string,
): ResolvedLocales {
  const sourceLocale = meta.sourceLocale ?? meta.localeFallback
  const available = meta.locales.includes(sourceLocale)
    ? meta.locales
    : [sourceLocale, ...meta.locales]
  const wanted = configured.trim()
  const displayLocale =
    wanted && available.includes(wanted)
      ? wanted
      : (available.find((locale) => locale !== sourceLocale) ?? sourceLocale)
  return {
    sourceLocale,
    displayLocale,
    available,
    fetch: [...new Set([sourceLocale, displayLocale])],
  }
}

export interface ProjectData {
  projectId: number
  projectName: string
  sourceLocale: string
  displayLocale: string
  locales: string[]
  /** Declared namespace names in the platform's display order. */
  namespaces: string[]
  /** Namespace names are relative to it. */
  keyPrefix: string
  /** Null when the server predates it. */
  keyConvention: DeliveryKeyConvention | null
  releaseNames: Map<number, string>
  /** In the platform's order. */
  releases: ProjectRelease[]
  canManageReleases: boolean
  /** The config's `release`, labelling keys the editor creates. */
  release: ReleaseRef | null
  /** A config `release` the project does not have. */
  missingRelease: string | undefined
  keys: DeliveryKeyState[]
  index: Map<string, DeliveryKeyState>
  fetchedAt: number
}

export function buildProjectData(
  meta: DeliveryMeta,
  states: KeyStatesResult,
  locales: ResolvedLocales,
  fetchedAt: number,
  configRelease?: string,
): ProjectData {
  const found = configRelease
    ? findRelease(meta.releases, configRelease)
    : undefined
  return {
    projectId: meta.project.id,
    projectName: meta.project.name,
    sourceLocale: locales.sourceLocale,
    displayLocale: locales.displayLocale,
    locales: locales.available,
    namespaces: (meta.namespaces ?? []).map((namespace) => namespace.name),
    keyPrefix: meta.keyConvention?.prefix ?? '',
    keyConvention: meta.keyConvention ?? null,
    releaseNames: new Map(
      meta.releases.map((release) => [Number(release.id), release.name]),
    ),
    releases: [...meta.releases].sort((a, b) => a.sort - b.sort),
    canManageReleases: meta.canManageReleases,
    release: found ? { id: Number(found.id), name: found.name } : null,
    missingRelease: configRelease && !found ? configRelease : undefined,
    keys: states.keys,
    index: buildIndex(states.keys),
    fetchedAt,
  }
}

/** The name when it is unique among the projects, otherwise the id. */
export function projectSetting(
  projects: readonly DeliveryProjectRef[],
  picked: DeliveryProjectRef,
): string | number {
  const sameName = projects.filter((project) => project.name === picked.name)
  return sameName.length === 1 ? picked.name : picked.id
}
