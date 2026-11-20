import * as vscode from 'vscode'
import type { DeliveryKeyState } from '@localness/sdk'
import type { DataController } from './controller'
import type { WorkspaceConfigs } from './configs'
import { groupByNamespace, type KeyGroup } from './core/namespaces'
import { STATE_ICONS, stateFor, truncate, textFor } from './core/keys'
import { filterByRelease, type ReleaseFilter } from './core/releases'
import { buildLocalHoverInfo } from './core/hover'
import { hoverInfoFor, hoverMarkdown } from './hover'
import type { LocalChanges } from './localChanges'

/** `local`: the texts of a key only the locale files have. */
export interface KeyItem {
  key: string
  state?: DeliveryKeyState
  local?: Readonly<Record<string, string>>
}

type Node =
  { type: 'group'; group: KeyGroup<KeyItem> } | ({ type: 'key' } & KeyItem)

class KeyTreeProvider implements vscode.TreeDataProvider<Node> {
  readonly #emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.#emitter.event

  filter: ReleaseFilter

  constructor(
    private readonly controller: DataController,
    private readonly changes: LocalChanges,
  ) {}

  refresh() {
    this.#emitter.fire()
  }

  getChildren(node?: Node): Node[] {
    const data = this.controller.data
    if (!data) return []
    if (!node) {
      const items: KeyItem[] = filterByRelease(data.keys, this.filter).map(
        (state) => ({ key: state.key, state }),
      )
      if (this.filter === undefined || this.filter === 'unassigned') {
        for (const [key, local] of this.changes.localOnly) {
          if (!data.index.has(key)) items.push({ key, local })
        }
      }
      return groupByNamespace(items, data.namespaces, data.keyPrefix).map(
        (group) => ({
          type: 'group',
          group,
        }),
      )
    }
    if (node.type === 'group') {
      return node.group.items.map((item) => ({ type: 'key', ...item }))
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
    const { state, local, key } = node
    const item = new vscode.TreeItem(key)
    if (!state) {
      item.id = `local:${key}`
      item.contextValue = 'localKey'
      item.iconPath = new vscode.ThemeIcon('cloud-upload')
      const text = data && local?.[data.displayLocale]
      item.description = text ? truncate(text, 60) : undefined
      if (data && local) {
        item.tooltip = hoverMarkdown(buildLocalHoverInfo(key, local, data))
      }
    } else {
      item.id = `key:${state.id}`
      item.contextValue = 'key'
    }
    if (state && data) {
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
      arguments: [key],
    }
    return item
  }
}

const FILTER_STATE = 'localness.keysReleaseFilter'

export function registerTree(
  controller: DataController,
  changes: LocalChanges,
  context: vscode.ExtensionContext,
  configs: WorkspaceConfigs,
): vscode.Disposable {
  const provider = new KeyTreeProvider(controller, changes)
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
    const release =
      filter === undefined
        ? undefined
        : filter === 'unassigned'
          ? 'No release'
          : (controller.data?.releaseNames.get(filter) ?? `release ${filter}`)
    view.description =
      [configs.describe(controller.config?.path), release]
        .filter(Boolean)
        .join(' · ') || undefined
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
    configs.onDidChange(sync),
    changes.onDidChange(() => provider.refresh()),
    vscode.commands.registerCommand(
      'localness.filterKeysByRelease',
      pickFilter,
    ),
  )
}
