import type { LocalnessClient } from '../client'
import type { LoadedConfig } from './config'
import { readLocalFiles, type LocalLocaleFile } from './local'
import { fetchPlatformTexts } from './platform'

/**
 * - `missing-locally`: the platform has text, the file lacks the key.
 * - `different`: both have text and it differs.
 * - `missing-on-platform`: the file has a key the platform does not know.
 * - `empty-on-platform`: the platform has the key but no text in this locale.
 */
export const DIFF_KINDS = [
  'missing-locally',
  'different',
  'missing-on-platform',
  'empty-on-platform',
] as const
export type DiffKind = (typeof DIFF_KINDS)[number]

export interface DiffEntry {
  locale: string
  key: string
  kind: DiffKind
  local: string | null
  platform: string | null
}

/** Two-way: it says where the sides differ, not which side changed. */
export function diffLocaleTexts(
  locales: readonly string[],
  local: Record<string, Record<string, string>>,
  platform: Record<string, Record<string, string | null>>,
): DiffEntry[] {
  const entries: DiffEntry[] = []
  for (const locale of locales) {
    const localTexts = local[locale] ?? {}
    const platformTexts = platform[locale] ?? {}
    const keys = new Set([
      ...Object.keys(localTexts),
      ...Object.keys(platformTexts),
    ])
    for (const key of [...keys].sort()) {
      const localText = Object.hasOwn(localTexts, key) ? localTexts[key]! : null
      const known = Object.hasOwn(platformTexts, key)
      const platformText = known ? platformTexts[key]! : null
      let kind: DiffKind | undefined
      if (!known) kind = 'missing-on-platform'
      else if (platformText === null) {
        if (localText !== null) kind = 'empty-on-platform'
      } else if (localText === null) kind = 'missing-locally'
      else if (localText !== platformText) kind = 'different'
      if (kind) {
        entries.push({
          locale,
          key,
          kind,
          local: localText,
          platform: platformText,
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
  locales: string[]
  files: LocalLocaleFile[]
  entries: DiffEntry[]
}

export async function compareLocaleFiles(
  loaded: LoadedConfig,
  client: LocalnessClient,
  options: CompareOptions = {},
): Promise<Comparison> {
  const platform = await fetchPlatformTexts(client, {
    locales: options.locales ?? loaded.config.locales,
    keys: options.keys,
    content: loaded.config.content,
  })
  const files = await readLocalFiles(loaded, platform.locales)
  const only = options.keys && new Set(options.keys)
  const local = Object.fromEntries(
    files.map((file) => [
      file.locale,
      only
        ? Object.fromEntries(
            Object.entries(file.content.entries).filter(([key]) =>
              only.has(key),
            ),
          )
        : file.content.entries,
    ]),
  )
  return {
    sourceLocale: platform.sourceLocale,
    locales: platform.locales,
    files,
    entries: diffLocaleTexts(platform.locales, local, platform.texts),
  }
}
