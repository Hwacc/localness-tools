import { randomBytes } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import * as vscode from 'vscode'
import {
  announceEditor,
  claimReview,
  createReviewSession,
  isAlive,
  isReviewId,
  readJson,
  reviewDir,
  reviewKindOf,
  reviewPage,
  reviewPaths,
  reviewSize,
  takenNames,
  toPlanCancelled,
  toResolveResult,
  toResult,
  withdrawEditor,
  writeJson,
  type PageMessage,
  type ReviewClaim,
  type ReviewDoc,
  type ReviewRow,
} from '@localness/sdk/review'
import type { DataController } from './controller'
import { showKeyInFile } from './localFiles'

const CLAIM: ReviewClaim = { pid: process.pid, editor: 'vscode' }

function panelTitle(doc: ReviewDoc) {
  const count = reviewSize(doc)
  switch (doc.kind) {
    case 'plan':
      return `Localness push plans (${count})`
    case 'resolve':
      return `Localness resolve (${count})`
    case 'extract':
    case undefined:
      return `Localness review (${count})`
    default: {
      const unhandled: never = doc
      return unhandled
    }
  }
}

function reviewLabel(doc: ReviewDoc) {
  switch (doc.kind) {
    case 'plan':
      return `Push plans ${doc.id}`
    case 'resolve':
      return `Resolve ${doc.id}`
    case 'extract':
    case undefined:
      return `Review ${doc.id}`
    default: {
      const unhandled: never = doc
      return unhandled
    }
  }
}

function reviewDescription(doc: ReviewDoc) {
  const count = reviewSize(doc)
  switch (doc.kind) {
    case 'plan':
      return `${count} keys in ${doc.plans.length} plans`
    case 'resolve':
      return `${count} keys`
    case 'extract':
    case undefined:
      return `${count} texts`
    default: {
      const unhandled: never = doc
      return unhandled
    }
  }
}

function cancelledResult(doc: ReviewDoc) {
  switch (doc.kind) {
    case 'plan':
      return toPlanCancelled(doc)
    case 'resolve':
      return toResolveResult(doc, 'cancelled', [])
    case 'extract':
    case undefined:
      return toResult(doc, 'cancelled', [])
    default: {
      const unhandled: never = doc
      return unhandled
    }
  }
}

/** The doc can fire its create event before the CLI finished writing it. */
async function readDoc(path: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const doc = await readJson<ReviewDoc>(path).catch(() => undefined)
    if (doc !== undefined) return doc
    await sleep(100)
  }
  return null
}

async function openLocation(root: string, file: string, key: string) {
  if (!file || !key) return
  const abs = resolve(root, file)
  const fromRoot = relative(root, abs)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) return
  await showKeyInFile(abs, key)
}

async function openRow(row: ReviewRow | undefined) {
  if (!row?.path) return
  const document = await vscode.workspace.openTextDocument(row.path)
  const line = Math.min(
    Math.max((row.line ?? 1) - 1, 0),
    document.lineCount - 1,
  )
  const text = row.text.split('\n')[0]!.trim()
  const start = document.lineAt(line).text.indexOf(text)
  const selection =
    start >= 0
      ? new vscode.Range(line, start, line, start + text.length)
      : new vscode.Range(line, 0, line, 0)
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    selection,
  })
}

/**
 * Shows `localness review` pages in a webview. While a project is loaded it
 * announces itself in `.localness/editors/`, so `review start` hands the
 * review here instead of to the browser.
 */
class ReviewHost implements vscode.Disposable {
  #root: string | undefined
  #closing = false
  #watcher: vscode.Disposable | undefined
  readonly #panels = new Map<string, vscode.WebviewPanel>()
  readonly #subscription: vscode.Disposable

  constructor(
    private readonly controller: DataController,
    private readonly log: vscode.OutputChannel,
  ) {
    this.#subscription = controller.onDidChange(() => void this.#follow())
    void this.#follow()
  }

  async #follow() {
    const { client, config } = this.controller
    const root = client ? config?.root : undefined
    if (root === this.#root) return
    this.#leave()
    this.#root = root
    if (!root) return
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(root),
        '.localness/review/*.json',
      ),
      false,
      true,
      true,
    )
    this.#watcher = vscode.Disposable.from(
      watcher,
      watcher.onDidCreate((uri) => void this.#onCreated(root, uri)),
    )
    await announceEditor(root).catch((error: unknown) =>
      this.log.appendLine(`Review: could not announce the editor: ${error}`),
    )
  }

  #leave() {
    this.#watcher?.dispose()
    this.#watcher = undefined
    if (this.#root) void withdrawEditor(this.#root).catch(() => {})
  }

  async #onCreated(root: string, uri: vscode.Uri) {
    const id = basename(uri.fsPath, '.json')
    if (!isReviewId(id)) return
    const doc = await readDoc(uri.fsPath)
    if (doc?.open !== 'editor') return
    if (!(await claimReview(reviewPaths(root, id).claim, CLAIM))) return
    this.log.appendLine(`Review ${id}: opened in the editor`)
    this.show(root, doc)
  }

  /** Reviews nobody answered whose page is gone or is this window's. */
  async pending() {
    const root = this.#root
    if (!root) return []
    const names = await readdir(reviewDir(root)).catch(() => [])
    const docs: ReviewDoc[] = []
    for (const name of names) {
      const id = basename(name, '.json')
      if (!isReviewId(id)) continue
      const paths = reviewPaths(root, id)
      if (await readJson(paths.result).catch(() => null)) continue
      const claim = await readJson<ReviewClaim>(paths.claim).catch(() => null)
      if (claim?.pid !== process.pid && isAlive(claim?.pid)) continue
      const doc = await readJson<ReviewDoc>(paths.doc).catch(() => null)
      if (doc) docs.push(doc)
    }
    return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async reopen(doc: ReviewDoc) {
    const root = this.#root
    if (!root) return
    await writeJson(reviewPaths(root, doc.id).claim, CLAIM)
    this.show(root, doc)
  }

  show(root: string, doc: ReviewDoc) {
    const open = this.#panels.get(doc.id)
    if (open) return open.reveal()
    const { client, config } = this.controller
    if (!client || config?.root !== root) {
      void vscode.window.showErrorMessage(
        `Localness: review ${doc.id} belongs to another project; open one of its files first.`,
      )
      return
    }
    const paths = reviewPaths(root, doc.id)
    const session = createReviewSession({
      doc,
      taken:
        doc.kind === 'extract' || doc.kind === undefined
          ? takenNames(config, client, doc.sourceLocale)
          : undefined,
      loaded: doc.kind === 'plan' ? config : undefined,
      onDone: (result) => writeJson(paths.result, result),
    })
    const panel = vscode.window.createWebviewPanel(
      'localness.review',
      panelTitle(doc),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    )
    this.#panels.set(doc.id, panel)
    panel.webview.html = reviewPage({
      host: 'webview',
      nonce: randomBytes(16).toString('hex'),
      kind: reviewKindOf(doc),
    })
    const reply = (id: number, value: unknown) =>
      void panel.webview.postMessage({ id, value })
    panel.webview.onDidReceiveMessage(async (message: PageMessage) => {
      switch (message.type) {
        case 'api':
          return reply(
            message.id,
            await session.request(message.method, message.path, message.body),
          )
        case 'confirm': {
          const choice = await vscode.window.showWarningMessage(
            message.message,
            { modal: true },
            'Cancel Review',
          )
          return reply(message.id, choice === 'Cancel Review')
        }
        case 'alert':
          return void vscode.window.showErrorMessage(
            `Localness: ${message.message}`,
          )
        case 'open':
          if (doc.kind === 'resolve' || doc.kind === 'plan') return
          return openRow(doc.rows.find((row) => row.index === message.index))
        case 'openLocation':
          if (doc.kind !== 'resolve') return
          return openLocation(root, message.path, message.key)
        default: {
          const unhandled: never = message
          return unhandled
        }
      }
    })
    void session.done.then((result) => {
      panel.dispose()
      this.log.appendLine(`Review ${doc.id}: ${result.status}`)
      void vscode.window.showInformationMessage(
        result.status === 'approved'
          ? 'Localness: review approved; your agent will apply it.'
          : 'Localness: review cancelled.',
      )
    })
    panel.onDidDispose(async () => {
      this.#panels.delete(doc.id)
      if (session.settled || this.#closing) return
      const choice = await vscode.window.showWarningMessage(
        `Localness: review ${doc.id} is still waiting for your decisions.`,
        'Reopen',
        'Cancel Review',
      )
      if (choice === 'Reopen') this.show(root, doc)
      if (choice === 'Cancel Review') {
        await writeJson(paths.result, cancelledResult(doc))
      }
    })
  }

  dispose() {
    this.#closing = true
    this.#subscription.dispose()
    this.#leave()
    for (const panel of this.#panels.values()) panel.dispose()
  }
}

export function registerReview(
  controller: DataController,
  log: vscode.OutputChannel,
) {
  const host = new ReviewHost(controller, log)
  return vscode.Disposable.from(
    host,
    vscode.commands.registerCommand('localness.openReview', async () => {
      const docs = await host.pending()
      if (docs.length === 0) {
        void vscode.window.showInformationMessage(
          'Localness: no review is waiting for you.',
        )
        return
      }
      const picked = await vscode.window.showQuickPick(
        docs.map((doc) => ({
          label: reviewLabel(doc),
          description: reviewDescription(doc),
          detail: new Date(doc.createdAt).toLocaleString(),
          doc,
        })),
        { placeHolder: 'Open a review that is waiting for your decisions' },
      )
      if (picked) await host.reopen(picked.doc)
    }),
  )
}
