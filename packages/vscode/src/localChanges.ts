import * as vscode from 'vscode'

/** How the locale files differ from the project, as the Local Files view last saw it. */
export class LocalChanges implements vscode.Disposable {
  readonly #emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.#emitter.event
  /** Differences other than texts waiting for a publish. */
  count = 0
  /** Those a push can send. */
  pushable = 0

  set(count: number, pushable: number) {
    if (count === this.count && pushable === this.pushable) return
    this.count = count
    this.pushable = pushable
    this.#emitter.fire()
  }

  dispose() {
    this.#emitter.dispose()
  }
}
