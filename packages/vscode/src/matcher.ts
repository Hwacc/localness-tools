import * as vscode from 'vscode'
import {
  compilePatterns,
  extractKeys,
  patternSources,
  type KeyMatch,
} from './core/extract'
import { readSettings } from './settings'

export interface DocumentKey extends KeyMatch {
  range: vscode.Range
}

export class KeyMatcher implements vscode.Disposable {
  #regexes: RegExp[] = []
  readonly #cache = new Map<string, { version: number; keys: DocumentKey[] }>()
  readonly #subscriptions: vscode.Disposable[]
  #reported = false

  constructor(readonly log: vscode.OutputChannel) {
    this.#compile()
    this.#subscriptions = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('localness.keyPatterns') ||
          event.affectsConfiguration('localness.useDefaultKeyPatterns')
        ) {
          this.#compile()
          this.#cache.clear()
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.#cache.delete(document.uri.toString())
      }),
    ]
  }

  isSupported(document: vscode.TextDocument) {
    return readSettings().languages.includes(document.languageId)
  }

  keysIn(document: vscode.TextDocument): DocumentKey[] {
    const id = document.uri.toString()
    const cached = this.#cache.get(id)
    if (cached?.version === document.version) return cached.keys
    let keys: DocumentKey[]
    try {
      keys = extractKeys(document.getText(), this.#regexes).map((match) => ({
        ...match,
        range: new vscode.Range(
          document.positionAt(match.start),
          document.positionAt(match.end),
        ),
      }))
    } catch (error) {
      if (!this.#reported) {
        this.#reported = true
        this.log.appendLine(
          `Failed to scan ${id} for keys: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        )
      }
      return []
    }
    this.#cache.set(id, { version: document.version, keys })
    return keys
  }

  #compile() {
    const settings = readSettings()
    const { regexes, errors } = compilePatterns(
      patternSources(settings.keyPatterns, settings.useDefaultKeyPatterns),
    )
    this.#regexes = regexes
    if (errors.length > 0) {
      void vscode.window.showWarningMessage(
        `Localness: ignored invalid localness.keyPatterns entries: ${errors
          .map((error) => `${error.source} (${error.message})`)
          .join('; ')}`,
      )
    }
  }

  dispose() {
    for (const subscription of this.#subscriptions) subscription.dispose()
  }
}
