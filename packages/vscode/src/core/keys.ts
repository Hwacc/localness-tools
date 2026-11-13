import type { DeliveryKeyState, DeliveryLocaleStateName } from '@localness/sdk'
import type { KeyMatch } from './extract'

export function textFor(
  state: DeliveryKeyState,
  locale: string,
): string | undefined {
  const entry = state.locales[locale]
  return entry?.draftText ?? entry?.publishedText ?? undefined
}

export function stateFor(
  state: DeliveryKeyState,
  locale: string,
): DeliveryLocaleStateName {
  return state.locales[locale]?.state ?? 'unpublished'
}

export const STATE_ICONS: Record<DeliveryLocaleStateName, string> = {
  draft: 'edit',
  published: 'check',
  outdated: 'warning',
  unpublished: 'circle-outline',
}

export function buildIndex(
  keys: readonly DeliveryKeyState[],
): Map<string, DeliveryKeyState> {
  return new Map(keys.map((state) => [state.key, state]))
}

export function findMissingKeys<T extends Pick<KeyMatch, 'key'>>(
  matches: readonly T[],
  index: ReadonlyMap<string, DeliveryKeyState>,
): T[] {
  return matches.filter((match) => !index.has(match.key))
}

export interface SearchOptions {
  sourceLocale: string
  displayLocale: string
  limit: number
}

/** Ranked: exact key, key prefix, key substring, source text, display text. */
export function searchCached(
  keys: readonly DeliveryKeyState[],
  query: string,
  options: SearchOptions,
): DeliveryKeyState[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const ranked: Array<{ rank: number; state: DeliveryKeyState }> = []
  for (const state of keys) {
    const key = state.key.toLowerCase()
    let rank = -1
    if (key === needle) rank = 0
    else if (key.startsWith(needle)) rank = 1
    else if (key.includes(needle)) rank = 2
    else if (
      textFor(state, options.sourceLocale)?.toLowerCase().includes(needle)
    )
      rank = 3
    else if (
      textFor(state, options.displayLocale)?.toLowerCase().includes(needle)
    )
      rank = 4
    if (rank >= 0) ranked.push({ rank, state })
  }
  ranked.sort(
    (a, b) => a.rank - b.rank || a.state.key.localeCompare(b.state.key),
  )
  return ranked.slice(0, options.limit).map((entry) => entry.state)
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function hintText(
  state: DeliveryKeyState,
  displayLocale: string,
  max: number,
): string {
  const text = textFor(state, displayLocale)
  return text === undefined ? '(no translation)' : truncate(text, max)
}

/** Inclusive interval overlap, for both line numbers and offsets. */
export function isRevealed(
  match: Pick<KeyMatch, 'start' | 'end'>,
  selections: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  return selections.some(
    (selection) => selection.start <= match.end && selection.end >= match.start,
  )
}

/** Hints sit after the closing quote when the key is quoted. */
export function hintOffset(text: string, match: KeyMatch): number {
  return /['"`]/.test(text.charAt(match.end)) ? match.end + 1 : match.end
}
