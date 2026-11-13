import * as vscode from 'vscode'
import type { DeliveryKeyState } from '@localness/sdk'
import type { DataController } from './controller'
import { groupByNamespace, type KeyGroup } from './core/namespaces'
import { STATE_ICONS, stateFor, truncate, textFor } from './core/keys'
import { hoverInfoFor, hoverMarkdown } from './hover'

type Node =
  | { type: 'group'; group: KeyGroup<DeliveryKeyState> }
  | { type: 'key'; state: DeliveryKeyState }

class KeyTreeProvider implements vscode.TreeDataProvider<Node> {
  readonly #emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.#emitter.event

  constructor(private readonly controller: DataController) {}

  refresh() {
    this.#emitter.fire()
  }

  getChildren(node?: Node): Node[] {
    const data = this.controller.data
    if (!data) return []
    if (!node) {
      return groupByNamespace(data.keys, data.namespaces).map((group) => ({
        type: 'group',
        group,
      }))
    }
    if (node.type === 'group') {
      return node.group.items.map((state) => ({ type: 'key', state }))
    }
    return []
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'group') {
      const { name, items } = node.group
      const item = new vscode.TreeItem(
        name ?? 'Ungrouped',
        vscode.TreeItemCollapsibleState.Collapsed,
      )
      item.id = `group:${name ?? ''}`
      item.description = String(items.length)
      item.iconPath = new vscode.ThemeIcon('symbol-namespace')
      return item
    }
    const data = this.controller.data
    const { state } = node
    const item = new vscode.TreeItem(state.key)
    item.id = `key:${state.id}`
    if (data) {
      const text = textFor(state, data.displayLocale)
      item.description = text === undefined ? undefined : truncate(text, 60)
      item.iconPath = new vscode.ThemeIcon(
        STATE_ICONS[stateFor(state, data.displayLocale)],
      )
      item.tooltip = hoverMarkdown(hoverInfoFor(this.controller, data, state))
    }
    item.command = {
      command: 'localness.openKey',
      title: 'Open in Localness',
      arguments: [state.id],
    }
    return item
  }
}

export function registerTree(controller: DataController): vscode.Disposable {
  const provider = new KeyTreeProvider(controller)
  const sync = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'localness.ready',
      controller.data !== undefined,
    )
    provider.refresh()
  }
  sync()
  return vscode.Disposable.from(
    vscode.window.registerTreeDataProvider('localness.keys', provider),
    controller.onDidChange(sync),
  )
}
