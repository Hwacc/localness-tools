import * as vscode from 'vscode'
import type { DataController } from './controller'
import { isInside } from './core/configs'
import { findMissingKeys } from './core/keys'
import { findKey } from './core/localeFile'
import type { LocalChanges } from './localChanges'
import type { KeyMatcher } from './matcher'
import { readSettings } from './settings'

export function registerDiagnostics(
  controller: DataController,
  matcher: KeyMatcher,
  changes: LocalChanges,
): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection('localness')
  let timer: ReturnType<typeof setTimeout> | undefined

  const update = (document: vscode.TextDocument) => {
    const data = controller.data
    const root = controller.config?.root
    if (
      !data ||
      !root ||
      document.uri.scheme !== 'file' ||
      !isInside(root, document.uri.fsPath) ||
      !readSettings().diagnostics ||
      !matcher.isSupported(document)
    ) {
      collection.delete(document.uri)
      return
    }
    const missing = findMissingKeys(
      matcher.keysIn(document),
      data.index,
    ).filter((match) => !changes.localOnly.has(match.key))
    collection.set(
      document.uri,
      missing.map((match) => {
        const diagnostic = new vscode.Diagnostic(
          match.range,
          'Key not found on remote',
          vscode.DiagnosticSeverity.Warning,
        )
        diagnostic.source = 'localness'
        return diagnostic
      }),
    )
  }

  const updateAll = () => {
    for (const document of vscode.workspace.textDocuments) update(document)
  }

  const duplicates = vscode.languages.createDiagnosticCollection(
    'localness-duplicates',
  )
  let marking = 0
  const markDuplicates = async () => {
    const run = ++marking
    const byPath = new Map<string, typeof changes.duplicates>()
    for (const mark of changes.duplicates) {
      byPath.set(mark.path, [...(byPath.get(mark.path) ?? []), mark])
    }
    const next = new Map<vscode.Uri, vscode.Diagnostic[]>()
    for (const [path, marks] of byPath) {
      const document = await vscode.workspace
        .openTextDocument(path)
        .then(undefined, () => undefined)
      if (!document) continue
      const text = document.getText()
      next.set(
        document.uri,
        marks.map((mark) => {
          const offset = findKey(text, mark.key) ?? 0
          const diagnostic = new vscode.Diagnostic(
            new vscode.Range(
              document.positionAt(offset),
              document.positionAt(offset),
            ),
            mark.message,
            vscode.DiagnosticSeverity.Warning,
          )
          diagnostic.source = 'localness'
          return diagnostic
        }),
      )
    }
    if (run !== marking) return
    duplicates.clear()
    for (const [uri, diagnostics] of next) duplicates.set(uri, diagnostics)
  }

  updateAll()
  return vscode.Disposable.from(
    collection,
    duplicates,
    controller.onDidChange(updateAll),
    changes.onDidChange(() => {
      updateAll()
      void markDuplicates()
    }),
    vscode.workspace.onDidOpenTextDocument(update),
    vscode.workspace.onDidCloseTextDocument((document) =>
      collection.delete(document.uri),
    ),
    vscode.workspace.onDidChangeTextDocument((event) => {
      clearTimeout(timer)
      timer = setTimeout(() => update(event.document), 300)
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('localness')) updateAll()
    }),
    { dispose: () => clearTimeout(timer) },
  )
}
