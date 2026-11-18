import * as vscode from 'vscode'
import type { DataController } from './controller'
import type { KeyMatcher } from './matcher'
import { readSettings } from './settings'

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['ts', 'mts', 'cts'],
  typescriptreact: ['tsx'],
  javascript: ['js', 'mjs', 'cjs'],
  javascriptreact: ['jsx'],
  html: ['html', 'htm'],
}
const EXCLUDE = '**/{node_modules,dist,out,build,.git,.localness}/**'
const MAX_FILES = 10_000

interface Usage {
  uri: vscode.Uri
  range: vscode.Range
  line: string
}

/** The open document's text when there is one, so unsaved edits count. */
async function readText(uri: vscode.Uri) {
  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri.toString(),
  )
  if (open) return open.getText()
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
}

function lineStarts(text: string) {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1;) {
    starts.push(index + 1)
    index = text.indexOf('\n', index + 1)
  }
  return starts
}

function positionAt(starts: readonly number[], offset: number) {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle]! <= offset) low = middle
    else high = middle - 1
  }
  return new vscode.Position(low, offset - starts[low]!)
}

async function findUsages(
  controller: DataController,
  matcher: KeyMatcher,
  key: string,
  token: vscode.CancellationToken,
) {
  const extensions = readSettings().languages.flatMap(
    (language) => LANGUAGE_EXTENSIONS[language] ?? [language],
  )
  const glob = `**/*.{${[...new Set(extensions)].join(',')}}`
  const root = controller.config?.root
  const files = await vscode.workspace.findFiles(
    root ? new vscode.RelativePattern(root, glob) : glob,
    EXCLUDE,
    MAX_FILES,
    token,
  )
  const usages: Usage[] = []
  for (const uri of files) {
    if (token.isCancellationRequested) break
    let text: string
    try {
      text = await readText(uri)
    } catch {
      continue
    }
    if (!text.includes(key)) continue
    const starts = lineStarts(text)
    for (const match of matcher.keysInText(text)) {
      if (match.key !== key) continue
      const start = positionAt(starts, match.start)
      usages.push({
        uri,
        range: new vscode.Range(start, positionAt(starts, match.end)),
        line: text
          .slice(starts[start.line], starts[start.line + 1] ?? text.length)
          .trim(),
      })
    }
  }
  return usages
}

async function reveal(usage: Usage, preview: boolean) {
  await vscode.window.showTextDocument(usage.uri, {
    selection: usage.range,
    preview,
    preserveFocus: preview,
  })
}

/**
 * Jumps to where `key` is used in code: straight there for one usage, through
 * a previewing quick pick for several.
 */
export async function showKeyUsages(
  controller: DataController,
  matcher: KeyMatcher,
  key: string,
) {
  let usages: Usage[]
  try {
    usages = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `Finding usages of ${key}`,
        cancellable: true,
      },
      (_progress, token) => findUsages(controller, matcher, key, token),
    )
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Localness: could not search for ${key}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }
  if (usages.length === 0) {
    void vscode.window.showInformationMessage(
      `Localness: ${key} is not used in the code.`,
    )
    return
  }
  if (usages.length === 1) {
    await reveal(usages[0]!, false)
    return
  }
  const items = usages.map((usage) => ({
    label: `${vscode.workspace.asRelativePath(usage.uri)}:${usage.range.start.line + 1}`,
    detail: usage.line,
    usage,
  }))
  const pick = vscode.window.createQuickPick<(typeof items)[number]>()
  pick.title = `${usages.length} usages of ${key}`
  pick.items = items
  pick.matchOnDetail = true
  const origin = vscode.window.activeTextEditor
  let accepted = false
  pick.onDidChangeActive(([item]) => {
    if (item) void reveal(item.usage, true)
  })
  pick.onDidAccept(() => {
    const [item] = pick.selectedItems
    accepted = true
    pick.hide()
    if (item) void reveal(item.usage, false)
  })
  pick.onDidHide(() => {
    pick.dispose()
    if (!accepted && origin) {
      void vscode.window.showTextDocument(origin.document, {
        selection: origin.selection,
        viewColumn: origin.viewColumn,
      })
    }
  })
  pick.show()
}
