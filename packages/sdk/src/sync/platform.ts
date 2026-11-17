import { normalizeLocaleText } from '@localness/contract/locale-file'
import { isUnnamedKey } from '@localness/contract/rules'
import type { LocalnessClient } from '../client'
import type { DeliveryKeyState } from '../schemas'
import type { SyncContent } from './config'

export interface PlatformTexts {
  sourceLocale: string
  /** The requested locales. */
  locales: string[]
  /**
   * Per locale, every named key: its text, or null when it has none. Also
   * holds the source locale when it was not requested, for push.
   */
  texts: Record<string, Record<string, string | null>>
  /** Same shape: the editor's working text, unpublished edits included. */
  drafts: Record<string, Record<string, string | null>>
}

type LocaleState = DeliveryKeyState['locales'][string] | undefined

/** The text a locale file gets from this state. */
export function platformTextOf(state: LocaleState, content: SyncContent) {
  return normalizeLocaleText(
    content === 'draft'
      ? (state?.draftText ?? state?.publishedText)
      : state?.publishedText,
  )
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
  const source = meta.sourceLocale
  const fetched =
    source === undefined || locales.includes(source)
      ? locales
      : [...locales, source]
  const result = await client.keyStates({
    locales: fetched,
    keys: options.keys,
  })
  const texts: PlatformTexts['texts'] = {}
  const drafts: PlatformTexts['drafts'] = {}
  for (const locale of fetched) {
    texts[locale] = Object.create(null)
    drafts[locale] = Object.create(null)
  }
  for (const key of result.keys) {
    if (isUnnamedKey(key.key)) continue
    for (const locale of fetched) {
      const state = key.locales[locale]
      texts[locale]![key.key] = platformTextOf(state, options.content)
      drafts[locale]![key.key] = normalizeLocaleText(state?.draftText)
    }
  }
  return { sourceLocale: result.sourceLocale, locales, texts, drafts }
}
