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
import { WorkspaceConfigs } from './configs'
import { affectsActiveConfig } from './core/configs'

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
  const configs = new WorkspaceConfigs()
  const onConfigFile = (deleted: boolean) => (uri: vscode.Uri) => {
    void configs.refresh()
    if (!affectsActiveConfig(uri.fsPath, controller.configPath)) return
    void (deleted ? controller.useConfig(undefined) : controller.reload())
  }
  const onFoldersChange = () => {
    void configs.refresh()
    const active = controller.configPath
    const kept =
      active && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(active))
    void (kept ? controller.reload() : controller.useConfig(undefined))
  }
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let lastRefresh = Date.now()

  context.subscriptions.push(
    log,
    controller,
    matcher,
    changes,
    configWatcher,
    configs,
    configWatcher.onDidCreate(onConfigFile(false)),
    configWatcher.onDidChange(onConfigFile(false)),
    configWatcher.onDidDelete(onConfigFile(true)),
    vscode.window.onDidChangeActiveTextEditor(
      () => void controller.followEditor(),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(onFoldersChange),
    registerStatusBar(controller, changes, configs),
    registerSyncView(controller, changes, configs),
    registerTree(controller, changes, context, configs),
    registerReleases(controller),
    registerHover(controller, matcher, changes),
    registerInlineHints(controller, matcher, changes),
    registerDiagnostics(controller, matcher, changes),
    registerCommands(controller, matcher, changes, configs, context),
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
  void configs.refresh()
}
