import type {
  DeliveryKeyState,
  DeliveryMeta,
  DeliveryProjectRef,
  KeyStatesResult,
} from '@localness/sdk'
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
  releaseNames: Map<number, string>
  keys: DeliveryKeyState[]
  index: Map<string, DeliveryKeyState>
  fetchedAt: number
}

export function buildProjectData(
  meta: DeliveryMeta,
  states: KeyStatesResult,
  locales: ResolvedLocales,
  fetchedAt: number,
): ProjectData {
  return {
    projectId: meta.project.id,
    projectName: meta.project.name,
    sourceLocale: locales.sourceLocale,
    displayLocale: locales.displayLocale,
    locales: locales.available,
    namespaces: (meta.namespaces ?? []).map((namespace) => namespace.name),
    releaseNames: new Map(
      meta.releases.map((release) => [Number(release.id), release.name]),
    ),
    keys: states.keys,
    index: buildIndex(states.keys),
    fetchedAt,
  }
}

/** The name when it is unique among the projects, otherwise the id. */
export function projectSetting(
  projects: readonly DeliveryProjectRef[],
  picked: DeliveryProjectRef,
): string {
  const sameName = projects.filter((project) => project.name === picked.name)
  return sameName.length === 1 ? picked.name : String(picked.id)
}
