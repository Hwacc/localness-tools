import * as vscode from 'vscode'
import { registerCommands } from './commands'
import { DataController } from './controller'
import { registerDiagnostics } from './diagnostics'
import { registerInlineHints } from './hints'
import { registerHover } from './hover'
import { KeyMatcher } from './matcher'
import { registerStatusBar } from './statusBar'
import { registerTree } from './tree'

const FOCUS_DEBOUNCE_MS = 1500
const FOCUS_MIN_INTERVAL_MS = 30_000
const RELOAD_SETTINGS = [
  'localness.baseUrl',
  'localness.project',
  'localness.displayLocale',
]

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Localness')
  const controller = new DataController(context)
  const matcher = new KeyMatcher(log)
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  let lastRefresh = Date.now()

  context.subscriptions.push(
    log,
    controller,
    matcher,
    registerStatusBar(controller),
    registerTree(controller),
    registerHover(controller, matcher),
    registerInlineHints(controller, matcher),
    registerDiagnostics(controller, matcher),
    registerCommands(controller, context.secrets),
    context.secrets.onDidChange((event) => {
      if (event.key.startsWith('localness.token:')) void controller.reload(true)
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (RELOAD_SETTINGS.some((name) => event.affectsConfiguration(name))) {
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
