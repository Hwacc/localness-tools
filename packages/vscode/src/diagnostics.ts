import * as vscode from 'vscode'
import type { DataController } from './controller'
import { findMissingKeys } from './core/keys'
import type { KeyMatcher } from './matcher'
import { readSettings } from './settings'

export function registerDiagnostics(
  controller: DataController,
  matcher: KeyMatcher,
): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection('localness')
  let timer: ReturnType<typeof setTimeout> | undefined

  const update = (document: vscode.TextDocument) => {
    const data = controller.data
    if (
      !data ||
      !readSettings().diagnostics ||
      !matcher.isSupported(document)
    ) {
      collection.delete(document.uri)
      return
    }
    const missing = findMissingKeys(matcher.keysIn(document), data.index)
    collection.set(
      document.uri,
      missing.map((match) => {
        const diagnostic = new vscode.Diagnostic(
          match.range,
          'Key not found in Localness',
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

  updateAll()
  return vscode.Disposable.from(
    collection,
    controller.onDidChange(updateAll),
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
