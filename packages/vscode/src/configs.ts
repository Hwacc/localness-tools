import * as vscode from 'vscode'
import { CONFIG_FILE_NAME } from '@localness/sdk/sync'
import type { DataController } from './controller'
import { configDirLabel, sameFile } from './core/configs'

/** The `localness.config.json` files in the workspace, found once and refreshed on change. */
export class WorkspaceConfigs implements vscode.Disposable {
  readonly #emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.#emitter.event
  #uris: readonly vscode.Uri[] = []
  #run = 0

  get uris() {
    return this.#uris
  }

  async refresh() {
    const run = ++this.#run
    const found = await vscode.workspace.findFiles(
      `**/${CONFIG_FILE_NAME}`,
      '**/node_modules/**',
    )
    if (run !== this.#run) return
    this.#uris = found.sort((a, b) => a.fsPath.localeCompare(b.fsPath))
    this.#emitter.fire()
  }

  /** The workspace-relative folder of `path`, for example `apps/web`. */
  label(path: string) {
    const uri = vscode.Uri.file(path)
    return configDirLabel(
      vscode.workspace.asRelativePath(uri),
      vscode.workspace.getWorkspaceFolder(uri)?.name ?? '.',
    )
  }

  /** The folder of `path` when the workspace has several configs, else nothing. */
  describe(path: string | undefined) {
    return path && this.#uris.length > 1 ? this.label(path) : undefined
  }

  dispose() {
    this.#emitter.dispose()
  }
}

export async function switchConfig(
  controller: DataController,
  configs: WorkspaceConfigs,
) {
  await configs.refresh()
  if (configs.uris.length === 0) {
    void vscode.window.showInformationMessage(
      `Localness: no ${CONFIG_FILE_NAME} in this workspace.`,
    )
    return
  }
  const active = controller.configPath
  const items = configs.uris.map((uri) => {
    const current = active !== undefined && sameFile(uri.fsPath, active)
    return {
      label: `${configs.label(uri.fsPath)}${current ? ' $(check)' : ''}`,
      description: vscode.workspace.asRelativePath(uri),
      detail:
        current && controller.data
          ? `Project: ${controller.data.projectName}`
          : undefined,
      path: uri.fsPath,
    }
  })
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder:
      'Config to use; opening a file under another config switches again',
    matchOnDescription: true,
  })
  if (picked) await controller.useConfig(picked.path)
}
