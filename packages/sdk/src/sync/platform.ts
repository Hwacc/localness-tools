import { normalizeLocaleText } from '@localness/contract/locale-file'
import { isUnnamedKey } from '@localness/contract/rules'
import type { LocalnessClient } from '../client'
import type { SyncContent } from './config'

export interface PlatformTexts {
  sourceLocale: string
  locales: string[]
  /** Per locale, every named key: its text, or null when it has none. */
  texts: Record<string, Record<string, string | null>>
}

export interface FetchPlatformTextsOptions {
  /** Omit for every project locale. */
  locales?: readonly string[]
  /** Only these key names. */
  keys?: readonly string[]
  content: SyncContent
}

/**
 * The text each key would have in a locale file. `__unnamed_` keys are left
 * out: their name is a placeholder that never ships.
 */
export async function fetchPlatformTexts(
  client: LocalnessClient,
  options: FetchPlatformTextsOptions,
): Promise<PlatformTexts> {
  const meta = await client.meta()
  const locales = options.locales ? [...options.locales] : meta.locales
  const unknown = locales.filter((locale) => !meta.locales.includes(locale))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown locale ${unknown.join(', ')}; ${meta.project.name} has ${meta.locales.join(', ')}.`,
    )
  }
  const result = await client.keyStates({ locales, keys: options.keys })
  const texts: PlatformTexts['texts'] = {}
  for (const locale of locales) texts[locale] = Object.create(null)
  for (const key of result.keys) {
    if (isUnnamedKey(key.key)) continue
    for (const locale of locales) {
      const state = key.locales[locale]
      const text =
        options.content === 'draft'
          ? (state?.draftText ?? state?.publishedText)
          : state?.publishedText
      texts[locale]![key.key] = normalizeLocaleText(text ?? null)
    }
  }
  return { sourceLocale: result.sourceLocale, locales, texts }
}
