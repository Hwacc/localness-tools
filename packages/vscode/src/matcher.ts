import * as vscode from 'vscode'
import type { DataController } from './controller'
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
  #sources: string | undefined
  readonly #cache = new Map<string, { version: number; keys: DocumentKey[] }>()
  readonly #subscriptions: vscode.Disposable[]
  #reported = false

  constructor(
    readonly log: vscode.OutputChannel,
    private readonly controller: DataController,
  ) {
    this.#compile()
    this.#subscriptions = [
      controller.onDidChange(() => this.#compile()),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.#cache.delete(document.uri.toString())
      }),
    ]
  }

  isSupported(document: vscode.TextDocument) {
    return readSettings().languages.includes(document.languageId)
  }

  /** Keys in text that is not open as a document; throws on a broken pattern. */
  keysInText(text: string) {
    return extractKeys(text, this.#regexes)
  }

  keysIn(document: vscode.TextDocument): DocumentKey[] {
    const id = document.uri.toString()
    const cached = this.#cache.get(id)
    if (cached?.version === document.version) return cached.keys
    let keys: DocumentKey[]
    try {
      keys = this.keysInText(document.getText()).map((match) => ({
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

  /** Compiles the config's patterns when they differ from the current ones. */
  #compile() {
    const config = this.controller.config?.config
    const sources = patternSources(
      config?.keyPatterns ?? [],
      config?.useDefaultKeyPatterns ?? true,
    )
    const signature = JSON.stringify(sources)
    if (signature === this.#sources) return
    this.#sources = signature
    const { regexes, errors } = compilePatterns(sources)
    this.#regexes = regexes
    this.#cache.clear()
    if (errors.length > 0) {
      void vscode.window.showWarningMessage(
        `Localness: ignored invalid "keyPatterns" entries in localness.config.json: ${errors
          .map((error) => `${error.source} (${error.message})`)
          .join('; ')}`,
      )
    }
  }

  dispose() {
    for (const subscription of this.#subscriptions) subscription.dispose()
  }
}
