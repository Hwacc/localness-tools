import { join } from 'node:path'
import * as vscode from 'vscode'
import { sameTexts } from './core/keys'

export interface DuplicateMark {
  /** Absolute path of the file holding a copy. */
  path: string
  key: string
  message: string
}

/** How the locale files differ from the project, as the Local Files view last saw it. */
export class LocalChanges implements vscode.Disposable {
  readonly #emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.#emitter.event
  /** Differences other than texts waiting for a publish. */
  count = 0
  /** Those a push can send. */
  pushable = 0
  /** Texts by locale of the keys only the locale files have. */
  localOnly: ReadonlyMap<string, Readonly<Record<string, string>>> = new Map()

  /** Locale-file keys whose texts differ between directories. */
  duplicates: readonly DuplicateMark[] = []

  set(
    count: number,
    pushable: number,
    localOnly: ReadonlyMap<string, Readonly<Record<string, string>>>,
  ) {
    if (
      count === this.count &&
      pushable === this.pushable &&
      sameTexts(localOnly, this.localOnly)
    )
      return
    this.count = count
    this.pushable = pushable
    this.localOnly = localOnly
    this.#emitter.fire()
  }

  setDuplicates(
    marks: readonly { relativePath: string; key: string; message: string }[],
    root: string | undefined,
  ) {
    const next = root
      ? marks.map(({ relativePath, key, message }) => ({
          path: join(root, ...relativePath.split('/')),
          key,
          message,
        }))
      : []
    if (JSON.stringify(next) === JSON.stringify(this.duplicates)) return
    this.duplicates = next
    this.#emitter.fire()
  }

  dispose() {
    this.#emitter.dispose()
  }
}
