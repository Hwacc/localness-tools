import * as vscode from 'vscode'
import { CONFIG_FILE_NAME } from '@localness/sdk/sync'
import { registerCommands } from './commands'
import { DataController } from './controller'
import { registerDiagnostics } from './diagnostics'
import { registerExtractText } from './extractText'
import { registerInlineHints } from './hints'
import { registerHover } from './hover'
import { registerSyncView } from './syncView'
import { KeyMatcher } from './matcher'
import { registerStatusBar } from './statusBar'
import { registerTree } from './tree'
import { registerReleases } from './releases'
import { registerReview } from './review'
import { LocalChanges } from './localChanges'

const FOCUS_DEBOUNCE_MS = 1500
const FOCUS_MIN_INTERVAL_MS = 30_000

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Localness')
  const controller = new DataController(context)
  const matcher = new KeyMatcher(log, controller)
  const changes = new LocalChanges()
  const configWatcher = vscode.workspace.createFileSystemWatcher(
    `**/${CONFIG_FILE_NAME}`,
  )
  const reloadConfig = () => void controller.reload()
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let lastRefresh = Date.now()

  context.subscriptions.push(
    log,
    controller,
    matcher,
    changes,
    configWatcher,
    configWatcher.onDidCreate(reloadConfig),
    configWatcher.onDidChange(reloadConfig),
    configWatcher.onDidDelete(reloadConfig),
    vscode.window.onDidChangeActiveTextEditor(
      () => void controller.followEditor(),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(reloadConfig),
    registerStatusBar(controller, changes),
    registerSyncView(controller, changes),
    registerTree(controller, context),
    registerReleases(controller),
    registerHover(controller, matcher),
    registerInlineHints(controller, matcher),
    registerDiagnostics(controller, matcher),
    registerCommands(controller, matcher, changes, context),
    registerExtractText(controller, matcher),
    registerReview(controller, log),
    context.secrets.onDidChange((event) => {
      if (event.key.startsWith('localness.token:')) void controller.reload(true)
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('localness.displayLocale')) {
        void controller.reload()
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      clearTimeout(focusTimer)
      if (!state.focused) return
      focusTimer = setTimeout(() => {
        if (Date.now() - lastRefresh < FOCUS_MIN_INTERVAL_MS) return
        lastRefresh = Date.now()
        void controller.reload(true)
      }, FOCUS_DEBOUNCE_MS)
    }),
    { dispose: () => clearTimeout(focusTimer) },
  )

  void controller.reload()
}
