import * as vscode from 'vscode'
import type { DataController } from './controller'

export function registerStatusBar(controller: DataController) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0,
  )
  item.name = 'Localness'
  item.command = 'localness.showMenu'

  const render = () => {
    const { status, data } = controller
    const label = data
      ? `${data.projectName} · ${data.displayLocale}`
      : 'Localness'
    switch (status.kind) {
      case 'loading':
        item.text = `$(sync~spin) ${label}`
        item.tooltip = 'Localness: loading'
        break
      case 'ready':
        item.text = `$(globe) ${label}`
        item.tooltip = 'Localness: click to switch locale or refresh'
        break
      case 'error':
        item.text = `$(warning) ${label}`
        item.tooltip = `Localness: ${status.message}`
        break
      case 'unconfigured':
        item.text = `$(globe) Localness: ${status.message}`
        item.tooltip = 'Localness: click to configure'
        break
    }
  }

  render()
  item.show()
  return vscode.Disposable.from(item, controller.onDidChange(render))
}
