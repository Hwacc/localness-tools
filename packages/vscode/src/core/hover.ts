import type { DeliveryKeyState, DeliveryLocaleStateName } from '@localness/sdk'
import { localeName } from './locales'
import { childKeys, publishedBehind, stateFor, textFor, truncate } from './keys'

export interface HoverContext {
  sourceLocale: string
  displayLocale: string
  releaseNames: ReadonlyMap<number, string>
  url: string
}

export interface HoverLocale {
  locale: string
  isSource: boolean
  text: string | undefined
  /** The published text while an unpublished edit differs from it. */
  published: string | undefined
  /** `local`: the key is only in the locale files. */
  state: DeliveryLocaleStateName | 'local'
}

export interface HoverInfo {
  key: string
  /** The source first, then the display locale when it differs. */
  locales: HoverLocale[]
  draft: boolean
  releases: string[]
  /** Absent while the key is only in the locale files. */
  url?: string
}

/** Links the editor adds; plain Markdown so the renderer stays testable. */
export interface HoverLinks {
  edit?: (locale: string) => string
  /** Icon buttons after the key name. */
  title?: readonly string[]
  footer?: readonly string[]
}

export function buildHoverInfo(
  state: DeliveryKeyState,
  context: HoverContext,
): HoverInfo {
  const locales = [...new Set([context.sourceLocale, context.displayLocale])]
  return {
    key: state.key,
    locales: locales.map((locale) => ({
      locale,
      isSource: locale === context.sourceLocale,
      text: textFor(state, locale),
      published: publishedBehind(state, locale),
      state: stateFor(state, locale),
    })),
    draft: state.draft,
    releases: state.releaseIds.map((id) => {
      const name = context.releaseNames.get(id)
      return name ? `${name} (#${id})` : `#${id}`
    }),
    url: context.url,
  }
}

export function buildLocalHoverInfo(
  key: string,
  texts: Readonly<Record<string, string>>,
  context: Pick<HoverContext, 'sourceLocale' | 'displayLocale'>,
): HoverInfo {
  const locales = [...new Set([context.sourceLocale, context.displayLocale])]
  return {
    key,
    locales: locales.map((locale) => ({
      locale,
      isSource: locale === context.sourceLocale,
      text: texts[locale],
      published: undefined,
      state: 'local',
    })),
    draft: false,
    releases: [],
  }
}

export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, '\\$&')
}

const STATE_BADGES: Record<HoverLocale['state'], string> = {
  local: '$(cloud-upload) Not pushed',
  published: '$(pass) Published',
  draft: '$(edit) Edited',
  outdated: '$(warning) Outdated',
  unpublished: '$(circle-large-outline) Not published',
}

function quote(text: string | undefined) {
  if (text === undefined || text === '') return '> _No text_'
  return `> ${escapeMarkdown(text).replace(/\r?\n/g, '  \n> ')}`
}

function localeSection(entry: HoverLocale, edit?: (locale: string) => string) {
  const title = [
    `**${escapeMarkdown(entry.locale.toUpperCase())}**`,
    escapeMarkdown(entry.isSource ? 'Source' : localeName(entry.locale)),
  ].join(' · ')
  const header = [title, STATE_BADGES[entry.state], edit?.(entry.locale)]
    .filter(Boolean)
    .join('&nbsp;&nbsp;&nbsp;')
  const body = [quote(entry.text)]
  if (entry.published !== undefined) {
    body.push('>', `> _Published:_ ${escapeMarkdown(entry.published)}`)
  }
  return `${header}\n\n${body.join('\n')}`
}

export function renderHoverMarkdown(
  info: HoverInfo,
  links: HoverLinks = {},
): string {
  const title = [
    [
      `$(key) **\`${info.key.replace(/`/g, "'")}\`**`,
      ...(links.title ?? []),
      ...(info.url
        ? [`[$(link-external)](${info.url} "Open in Localness")`]
        : []),
    ].join(' '),
  ]
  if (info.draft) title.push('$(circle-filled) Unpublished changes')
  const releases =
    info.releases.length > 0
      ? info.releases.map(escapeMarkdown).join(', ')
      : 'none'
  const head = info.url
    ? `${title.join('&nbsp;&nbsp;&nbsp;')}  \nReleases: ${releases}`
    : `${title.join('&nbsp;&nbsp;&nbsp;')}  \nOnly in the locale files`
  return [
    head,
    ...info.locales.map((entry) => localeSection(entry, links.edit)),
    ...(links.footer?.length ? [links.footer.join(' · ')] : []),
  ].join('\n\n---\n\n')
}

export const PREFIX_HOVER_LIMIT = 10

export interface PrefixHoverChild {
  key: string
  text: string | undefined
  /** Only in the locale files. */
  local: boolean
}

/** A key the code reads whole, as the array or object of the keys below it. */
export interface PrefixHoverInfo {
  prefix: string
  locale: string
  children: PrefixHoverChild[]
  /** Children past the limit, not listed. */
  more: number
}

/** Undefined when no key sits below `prefix`. */
export function buildPrefixHoverInfo(
  prefix: string,
  index: ReadonlyMap<string, DeliveryKeyState>,
  localOnly: ReadonlyMap<string, Readonly<Record<string, string>>>,
  displayLocale: string,
  limit = PREFIX_HOVER_LIMIT,
): PrefixHoverInfo | undefined {
  const keys = childKeys([...index.keys(), ...localOnly.keys()], prefix)
  if (keys.length === 0) return undefined
  return {
    prefix,
    locale: displayLocale,
    children: keys.slice(0, limit).map((key) => {
      const state = index.get(key)
      return state
        ? { key, text: textFor(state, displayLocale), local: false }
        : { key, text: localOnly.get(key)?.[displayLocale], local: true }
    }),
    more: Math.max(0, keys.length - limit),
  }
}

export function renderPrefixHoverMarkdown(info: PrefixHoverInfo): string {
  const count = info.children.length + info.more
  const head = [
    `$(symbol-array) **\`${info.prefix.replace(/`/g, "'")}\`**`,
    `${count} ${count === 1 ? 'key' : 'keys'} below`,
    `**${escapeMarkdown(info.locale.toUpperCase())}** · ${escapeMarkdown(localeName(info.locale))}`,
  ].join('&nbsp;&nbsp;&nbsp;')
  const lines = info.children.map((child) => {
    const text =
      child.text === undefined || child.text === ''
        ? '_No text_'
        : escapeMarkdown(truncate(child.text, 80))
    const badge = child.local ? ' $(cloud-upload)' : ''
    return `- \`${child.key.replace(/`/g, "'")}\`${badge} ${text}`
  })
  if (info.more > 0) lines.push(`- … ${info.more} more`)
  return `${head}\n\n---\n\n${lines.join('\n')}`
}
