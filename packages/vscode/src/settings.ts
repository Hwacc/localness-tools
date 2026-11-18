import * as vscode from 'vscode'

export const INLINE_HINT_MODES = ['inline', 'replace', 'off'] as const
export type InlineHintMode = (typeof INLINE_HINT_MODES)[number]
export const INLINE_HINT_STYLES = ['inlay', 'dot', 'arrow', 'plain'] as const
export type InlineHintStyle = (typeof INLINE_HINT_STYLES)[number]
export const REPLACE_REVEAL_ON = ['line', 'cursor'] as const
export type ReplaceRevealOn = (typeof REPLACE_REVEAL_ON)[number]

function oneOf<T extends string>(values: readonly T[], value: string): T {
  return values.includes(value as T) ? (value as T) : values[0]!
}

/** Personal settings; project settings live in `localness.config.json`. */
export interface Settings {
  displayLocale: string
  inlineHints: InlineHintMode
  inlineHintStyle: InlineHintStyle
  replaceRevealOn: ReplaceRevealOn
  inlineHintMaxLength: number
  keyUnderline: boolean
  diagnostics: boolean
  languages: string[]
  /** How to run the Localness CLI in a terminal. */
  cliCommand: string
}

export function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration('localness')
  return {
    displayLocale: config.get('displayLocale', '').trim(),
    inlineHints: oneOf(INLINE_HINT_MODES, config.get('inlineHints', '')),
    inlineHintStyle: oneOf(
      INLINE_HINT_STYLES,
      config.get('inlineHintStyle', ''),
    ),
    replaceRevealOn: oneOf(
      REPLACE_REVEAL_ON,
      config.get('replaceRevealOn', ''),
    ),
    inlineHintMaxLength: config.get('inlineHintMaxLength', 40),
    keyUnderline: config.get('keyUnderline', true),
    diagnostics: config.get('diagnostics', true),
    languages: config.get('languages', []),
    cliCommand: config.get('cliCommand', '').trim() || 'localness',
  }
}

export function updateSetting(name: string, value: string) {
  const target = vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global
  return vscode.workspace
    .getConfiguration('localness')
    .update(name, value, target)
}
