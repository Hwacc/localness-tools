import type { DeliveryKeyState, DeliveryLocaleStateName } from '@localness/sdk'
import { stateFor, textFor } from './keys'

export interface HoverContext {
  sourceLocale: string
  displayLocale: string
  releaseNames: ReadonlyMap<number, string>
  url: string
}

export interface HoverInfo {
  key: string
  sourceLocale: string
  sourceText: string | undefined
  displayLocale: string
  displayText: string | undefined
  state: DeliveryLocaleStateName
  draft: boolean
  releases: string[]
  url: string
}

export function buildHoverInfo(
  state: DeliveryKeyState,
  context: HoverContext,
): HoverInfo {
  return {
    key: state.key,
    sourceLocale: context.sourceLocale,
    sourceText: textFor(state, context.sourceLocale),
    displayLocale: context.displayLocale,
    displayText: textFor(state, context.displayLocale),
    state: stateFor(state, context.displayLocale),
    draft: state.draft,
    releases: state.releaseIds.map((id) => {
      const name = context.releaseNames.get(id)
      return name ? `${name} (#${id})` : `#${id}`
    }),
    url: context.url,
  }
}

export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, '\\$&')
}

function quote(text: string | undefined) {
  if (text === undefined) return '_none_'
  return `> ${escapeMarkdown(text).replace(/\r?\n/g, '  \n> ')}`
}

export function renderHoverMarkdown(info: HoverInfo): string {
  const lines = [
    `**${escapeMarkdown(info.key)}**`,
    `Source (${escapeMarkdown(info.sourceLocale)}):\n\n${quote(info.sourceText)}`,
  ]
  if (info.displayLocale !== info.sourceLocale) {
    lines.push(
      `${escapeMarkdown(info.displayLocale)}:\n\n${quote(info.displayText)}`,
    )
  }
  const status = [`State: ${info.state}`]
  if (info.draft) status.push('key is a draft')
  lines.push(status.join(' · '))
  lines.push(
    `Releases: ${info.releases.length > 0 ? info.releases.map(escapeMarkdown).join(', ') : 'none'}`,
  )
  lines.push(`[Open in Localness](${info.url})`)
  return lines.join('\n\n')
}
