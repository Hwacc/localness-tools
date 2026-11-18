import * as vscode from 'vscode'
import type { DeliveryKeyState } from '@localness/sdk'
import type { DataController } from './controller'
import { groupByNamespace, type KeyGroup } from './core/namespaces'
import { STATE_ICONS, stateFor, truncate, textFor } from './core/keys'
import { filterByRelease, type ReleaseFilter } from './core/releases'
import { hoverInfoFor, hoverMarkdown } from './hover'

type Node =
  | { type: 'group'; group: KeyGroup<DeliveryKeyState> }
  | { type: 'key'; state: DeliveryKeyState }

class KeyTreeProvider implements vscode.TreeDataProvider<Node> {
  readonly #emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.#emitter.event

  filter: ReleaseFilter

  constructor(private readonly controller: DataController) {}

  refresh() {
    this.#emitter.fire()
  }

  getChildren(node?: Node): Node[] {
    const data = this.controller.data
    if (!data) return []
    if (!node) {
      const keys = filterByRelease(data.keys, this.filter)
      return groupByNamespace(keys, data.namespaces).map((group) => ({
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
      item.contextValue = 'group'
      item.description = String(items.length)
      item.iconPath = new vscode.ThemeIcon('symbol-namespace')
      return item
    }
    const data = this.controller.data
    const { state } = node
    const item = new vscode.TreeItem(state.key)
    item.id = `key:${state.id}`
    item.contextValue = 'key'
    if (data) {
      const text = textFor(state, data.displayLocale)
      item.description = text === undefined ? undefined : truncate(text, 60)
      item.iconPath = new vscode.ThemeIcon(
        STATE_ICONS[stateFor(state, data.displayLocale)],
      )
      item.tooltip = hoverMarkdown(hoverInfoFor(this.controller, data, state))
    }
    item.command = {
      command: 'localness.findUsages',
      title: 'Find usages',
      arguments: [state.key],
    }
    return item
  }
}

const FILTER_STATE = 'localness.keysReleaseFilter'

export function registerTree(
  controller: DataController,
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const provider = new KeyTreeProvider(controller)
  provider.filter = context.workspaceState.get<ReleaseFilter>(FILTER_STATE)
  const view = vscode.window.createTreeView('localness.keys', {
    treeDataProvider: provider,
    canSelectMany: true,
  })
  const sync = () => {
    void vscode.commands.executeCommand(
      'setContext',
      'localness.ready',
      controller.data !== undefined,
    )
    const { filter } = provider
    view.description =
      filter === undefined
        ? undefined
        : filter === 'unassigned'
          ? 'No release'
          : (controller.data?.releaseNames.get(filter) ?? `release ${filter}`)
    provider.refresh()
  }
  const pickFilter = async () => {
    const data = controller.data
    if (!data) return
    const items: Array<vscode.QuickPickItem & { filter: ReleaseFilter }> = [
      { label: 'All keys', filter: undefined },
      ...data.releases.map((release) => ({
        label: release.name,
        filter: Number(release.id),
      })),
      { label: 'No release', filter: 'unassigned' as const },
    ]
    for (const item of items) {
      if (item.filter === provider.filter) item.description = 'current'
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Show keys of release',
    })
    if (!picked) return
    provider.filter = picked.filter
    await context.workspaceState.update(FILTER_STATE, picked.filter)
    sync()
  }
  sync()
  return vscode.Disposable.from(
    view,
    controller.onDidChange(sync),
    vscode.commands.registerCommand(
      'localness.filterKeysByRelease',
      pickFilter,
    ),
  )
}
