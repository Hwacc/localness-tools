import * as vscode from 'vscode'
import {
  FORCED_PULL_KINDS,
  FORCED_PUSH_KINDS,
  PULL_KINDS,
  PUSH_KINDS,
  STATE_DIR,
  applyPush,
  checkPlan,
  compareLocaleFiles,
  describeBlocked,
  describeViolations,
  normalizeDir,
  planPush,
  pullLocaleFiles,
  readBase,
  recordPush,
  writeBase,
  type Comparison,
  type DiffEntry,
  type DiffKind,
  type LoadedConfig,
} from '@localness/sdk/sync'
import type { LocalnessClient } from '@localness/sdk'
import type { DataController } from './controller'
import { describeError } from './core/errors'
import { placeKeys, showKeyInFile } from './localFiles'
import { localOnlyTexts, truncate } from './core/keys'
import { duplicateMarks } from './core/placement'
import { readSettings } from './settings'
import { releaseForNewKeys } from './releases'
import type { LocalChanges } from './localChanges'

const VIEW = 'localness.sync'
const TEXT_SCHEME = 'localness-text'
const REFRESH_DEBOUNCE_MS = 1500

const KIND_GROUPS: Record<DiffKind, { label: string; icon: string }> = {
  'platform-added': { label: 'New on remote', icon: 'diff-added' },
  'platform-changed': { label: 'Changed on remote', icon: 'cloud' },
  'platform-deleted': { label: 'Removed from remote', icon: 'trash' },
  'local-added': { label: 'Only in the locale files', icon: 'file-add' },
  'local-changed': { label: 'Changed locally', icon: 'edit' },
  'local-deleted': { label: 'Removed locally', icon: 'diff-removed' },
  different: { label: 'Different, no base', icon: 'question' },
  conflict: { label: 'Conflicts', icon: 'warning' },
  duplicate: { label: 'In several directories', icon: 'copy' },
  'pending-publish': { label: 'Waiting for publish', icon: 'clock' },
}
const KIND_ORDER = Object.keys(KIND_GROUPS) as DiffKind[]
/** Kinds a group pull takes without asking: what `localness pull` takes, plus removals. */
const GROUP_PULL_KINDS = new Set<DiffKind>([...PULL_KINDS, 'platform-deleted'])

type Node =
  | { type: 'group'; kind: DiffKind; entries: DiffEntry[] }
  | { type: 'entry'; entry: DiffEntry }

const pullable = (entry: DiffEntry) =>
  entry.platform !== null || entry.kind === 'platform-deleted'

const pushable = (entry: DiffEntry) =>
  entry.local !== null && FORCED_PUSH_KINDS.includes(entry.kind)

const contextValue = (type: string, flags: Record<string, boolean>) =>
  [type, ...Object.keys(flags).filter((flag) => flags[flag])].join('.')

const entryId = (entry: DiffEntry) =>
  `${entry.kind}:${entry.locale}:${entry.key}`

function quote(text: string | null) {
  return text === null ? '_none_' : `\`${text.replace(/`/g, "'")}\``
}

function entryTooltip(entry: DiffEntry) {
  const lines = [
    `**${entry.key}** · ${entry.locale} · ${KIND_GROUPS[entry.kind].label}`,
    '',
    `- Locale file: ${quote(entry.local)}`,
    `- Remote: ${quote(entry.platform)}`,
  ]
  if (entry.draft !== null && entry.draft !== entry.platform) {
    lines.push(`- Remote draft: ${quote(entry.draft)}`)
  }
  if (entry.base !== null) lines.push(`- Last synced: ${quote(entry.base)}`)
  if (entry.locations.length > 1) {
    for (const place of entry.locations) {
      lines.push(`- ${place.relativePath}: ${quote(place.value)}`)
    }
  } else if (entry.kind === 'duplicate') {
    lines.push(`- No ${entry.locale} text yet in: ${entry.dirs.join(', ')}`)
  }
  return new vscode.MarkdownString(lines.join('\n'))
}

class SyncTreeProvider implements vscode.TreeDataProvider<Node> {
  readonly #emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.#emitter.event
  comparison: Comparison | undefined

  update(comparison: Comparison | undefined) {
    this.comparison = comparison
    this.#emitter.fire()
  }

  getChildren(node?: Node): Node[] {
    const entries = this.comparison?.entries ?? []
    if (node?.type === 'group') {
      return node.entries.map((entry) => ({ type: 'entry', entry }))
    }
    if (node) return []
    return KIND_ORDER.flatMap((kind) => {
      const found = entries.filter((entry) => entry.kind === kind)
      return found.length > 0 ? [{ type: 'group', kind, entries: found }] : []
    })
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'group') {
      const { label, icon } = KIND_GROUPS[node.kind]
      const item = new vscode.TreeItem(
        label,
        node.kind === 'pending-publish'
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded,
      )
      item.id = `group:${node.kind}`
      item.description = String(node.entries.length)
      item.iconPath = new vscode.ThemeIcon(icon)
      item.contextValue = contextValue('syncGroup', {
        pull: GROUP_PULL_KINDS.has(node.kind),
        push: PUSH_KINDS.includes(node.kind),
      })
      return item
    }
    const { entry } = node
    const item = new vscode.TreeItem(entry.key)
    item.id = entryId(entry)
    const shown = entry.local ?? entry.platform
    item.description = `${entry.locale}${shown === null ? '' : ` · ${truncate(shown, 50)}`}`
    item.tooltip = entryTooltip(entry)
    item.contextValue = contextValue('syncEntry', {
      pull: pullable(entry),
      push: pushable(entry),
      local: entry.local !== null || entry.locations.length > 0,
      project: entry.onPlatform,
    })
    item.command = {
      command: 'localness.sync.compare',
      title: 'Compare',
      arguments: [node],
    }
    return item
  }
}

/** Virtual documents holding one side's text, for `vscode.diff`. */
class TextProvider implements vscode.TextDocumentContentProvider {
  readonly #texts = new Map<string, string>()
  #next = 0

  uri(label: string, text: string | null) {
    const id = String(++this.#next)
    this.#texts.set(id, text ?? '')
    return vscode.Uri.from({
      scheme: TEXT_SCHEME,
      path: `/${label}`,
      query: id,
    })
  }

  provideTextDocumentContent(uri: vscode.Uri) {
    return this.#texts.get(uri.query) ?? ''
  }
}

function runInTerminal(cwd: string, args: string) {
  const name = 'Localness'
  const terminal =
    vscode.window.terminals.find(
      (one) => one.name === name && one.exitStatus === undefined,
    ) ?? vscode.window.createTerminal({ name, cwd })
  terminal.show()
  terminal.sendText(`${readSettings().cliCommand} ${args}`)
}

/**
 * The Local Files view: what differs between the locale files and the project,
 * grouped by kind, with a badge on the activity bar. Refreshed when the project
 * data, the locale files or the base change.
 */
export function registerSyncView(
  controller: DataController,
  changes: LocalChanges,
) {
  const provider = new SyncTreeProvider()
  const texts = new TextProvider()
  const view = vscode.window.createTreeView(VIEW, {
    treeDataProvider: provider,
    showCollapseAll: true,
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let watcher: vscode.FileSystemWatcher | undefined
  let watched: string | undefined
  const show = (comparison: Comparison | undefined, message?: string) => {
    provider.update(comparison)
    const entries =
      comparison?.entries.filter((entry) => entry.kind !== 'pending-publish') ??
      []
    const count = entries.length
    const tooltip = `${count} locale-file ${count === 1 ? 'text differs' : 'texts differ'} from remote`
    view.badge = count > 0 ? { value: count, tooltip } : undefined
    changes.set(
      count,
      entries.filter(
        (entry) => PUSH_KINDS.includes(entry.kind) && pushable(entry),
      ).length,
      localOnlyTexts(entries),
    )
    changes.setDuplicates(duplicateMarks(entries), controller.config?.root)
    const dirs = new Set(comparison?.files.map((file) => file.dir))
    view.description = dirs.size > 1 ? [...dirs].join(', ') : undefined
    view.message =
      message ??
      (comparison && comparison.entries.length === 0
        ? `The locale files match the remote ${comparison.content} text.`
        : comparison?.warnings.join(' ') || undefined)
  }

  const refresh = async () => {
    clearTimeout(timer)
    const run = ++generation
    const { status, config: loaded, client } = controller
    const hasFiles = Boolean(loaded?.config.files)
    void vscode.commands.executeCommand(
      'setContext',
      'localness.hasLocaleFiles',
      hasFiles,
    )
    if (status.kind !== 'ready' || !loaded || !hasFiles || !client) {
      show(undefined)
      return
    }
    try {
      const comparison = await compareLocaleFiles(loaded, client)
      if (run === generation) show(comparison)
    } catch (error) {
      if (run === generation) {
        show(
          undefined,
          `Could not compare: ${describeError(error, client.baseUrl)}`,
        )
      }
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS)
  }

  const follow = () => {
    const loaded = controller.config
    const dirs = (loaded?.config.files ?? []).map((file) => {
      const dir = normalizeDir(file.dir).replace(/^\.$/, '')
      return `${dir ? `${dir}/` : ''}**/*.json`
    })
    const pattern = loaded
      ? `{${[...new Set(dirs), `${STATE_DIR}/base.json`].join(',')}}`
      : undefined
    const key =
      loaded && dirs.length > 0 ? `${loaded.root}|${pattern}` : undefined
    if (key === watched) return
    watcher?.dispose()
    watcher = undefined
    watched = key
    if (!loaded || !pattern || !key) return
    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(loaded.root, pattern),
    )
    watcher.onDidCreate(schedule)
    watcher.onDidChange(schedule)
    watcher.onDidDelete(schedule)
  }

  /** `entries` compared afresh, so nothing changed since the view refreshed is lost. */
  const compareAgain = async (
    loaded: LoadedConfig,
    client: LocalnessClient,
    entries: readonly DiffEntry[],
  ) => {
    const wanted = new Set(
      entries.map((entry) => `${entry.locale}\0${entry.key}`),
    )
    const fresh = await compareLocaleFiles(loaded, client, {
      keys: [...new Set(entries.map((entry) => entry.key))],
      locales: [...new Set(entries.map((entry) => entry.locale))],
    })
    return {
      ...fresh,
      entries: fresh.entries.filter((entry) =>
        wanted.has(`${entry.locale}\0${entry.key}`),
      ),
    }
  }

  /**
   * Writes the project's text for `entries`, compared afresh so nothing
   * written meanwhile is lost; removals only for keys the project dropped.
   */
  const pull = async (entries: readonly DiffEntry[]) => {
    const { config: loaded, client } = controller
    if (!loaded || !client || entries.length === 0) return
    const overwrites = entries.filter(
      (entry) =>
        (entry.local !== null || entry.locations.length > 0) &&
        !GROUP_PULL_KINDS.has(entry.kind),
    )
    if (overwrites.length > 0) {
      const replace = 'Replace'
      const answer = await vscode.window.showWarningMessage(
        overwrites.length === 1
          ? `Replace the local text of ${overwrites[0]!.key} (${overwrites[0]!.locale}) with the remote text?`
          : `Replace ${overwrites.length} local texts with the remote text?`,
        { modal: true },
        replace,
      )
      if (answer !== replace) return
    }
    try {
      const compared = await compareAgain(loaded, client, entries)
      const prune = compared.entries.some(
        (entry) => entry.kind === 'platform-deleted',
      )
      const placed = await placeKeys(loaded, compared, FORCED_PULL_KINDS, false)
      if (!placed) return
      const plan = await pullLocaleFiles(loaded, placed.comparison, {
        kinds: FORCED_PULL_KINDS,
        prune,
        into: placed.into,
      })
      const written = plan.files.filter((file) => file.output !== null)
      const skipped = plan.files.flatMap((file) => file.skipped)
      if (skipped.length > 0) {
        void vscode.window.showWarningMessage(
          `Localness: ${skipped.join(', ')} would break the structure of the locale files and ${skipped.length === 1 ? 'was' : 'were'} left out.`,
        )
      }
      vscode.window.setStatusBarMessage(
        written.length > 0
          ? `Localness: updated ${written.map((file) => file.relativePath).join(', ')}`
          : 'Localness: nothing to write',
        4000,
      )
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Localness: could not pull: ${describeError(error, client.baseUrl)}`,
      )
    }
    await refresh()
  }

  /**
   * Sends the locale files' text for `entries`, after the user confirms what
   * will be written: new keys are created and published from the source
   * locale file, other texts become drafts. Stops if the project moved meanwhile.
   */
  const push = async (entries: readonly DiffEntry[]) => {
    const { config: loaded, client } = controller
    if (!loaded || !client || entries.length === 0) return
    try {
      const comparison = await compareAgain(loaded, client, entries)
      let plan = planPush(loaded, comparison, { kinds: FORCED_PUSH_KINDS })
      if (plan.keys.some((one) => one.create)) {
        const release = releaseForNewKeys(controller)
        if (release === undefined) return
        plan = { ...plan, release }
      }
      const blocked = plan.blocked.map(
        (one) =>
          `${one.key} (${one.locale}): ${describeBlocked(one, plan.sourceLocale)}`,
      )
      if (plan.keys.length === 0) {
        void vscode.window.showWarningMessage(
          blocked.length > 0
            ? `Localness: nothing can be pushed: ${blocked.join('; ')}`
            : 'Localness: nothing to push.',
        )
        return
      }
      const lines = plan.keys.map((one) => {
        const locales = Object.keys(one.locales)
        return [
          one.key,
          one.create ? `create, ${plan.sourceLocale} published` : '',
          locales.length > 0 ? `drafts: ${locales.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      })
      const replaced = comparison.entries.filter(
        (entry) => !PUSH_KINDS.includes(entry.kind) && pushable(entry),
      )
      const detail = [
        ...lines.slice(0, 12),
        lines.length > 12 ? `… and ${lines.length - 12} more` : '',
        replaced.length > 0
          ? `\n${replaced.length} of these replace text changed on remote.`
          : '',
        blocked.length > 0 ? `\nLeft out: ${blocked.join('; ')}` : '',
        plan.warnings.length > 0
          ? `\nOff the suggested key style: ${plan.warnings
              .map(
                (one) => `${one.key} (${describeViolations(one.violations)})`,
              )
              .join('; ')}`
          : '',
        plan.release ? `\nNew keys are labelled ${plan.release.name}.` : '',
        '\nDrafts reach the bundle once published in Localness.',
      ]
        .filter(Boolean)
        .join('\n')
      const confirm = 'Push'
      const answer = await vscode.window.showWarningMessage(
        `Push ${plan.keys.length === 1 ? plan.keys[0]!.key : `${plan.keys.length} keys`} to remote?`,
        { modal: true, detail },
        confirm,
      )
      if (answer !== confirm) return
      const check = await checkPlan(client, plan)
      if (check.expired || check.stale.length > 0) {
        void vscode.window.showWarningMessage(
          `Localness: remote changed meanwhile (${check.stale.join(', ')}); nothing was pushed.`,
        )
        return
      }
      const result = await applyPush(client, plan, check)
      await writeBase(loaded, recordPush(await readBase(loaded), plan, result))
      const keys = result.written.map((done) => done.key)
      if (keys.length > 0) {
        const { keys: states } = await client.keyStates({ keys })
        for (const state of states) controller.applyKeyState(state)
      }
      if (result.failed) {
        void vscode.window.showErrorMessage(
          `Localness: pushed ${keys.length} of ${plan.keys.length} keys; stopped at ${result.failed.key}: ${result.failed.message}`,
        )
      } else {
        vscode.window.setStatusBarMessage(
          `Localness: pushed ${keys.length === 1 ? keys[0] : `${keys.length} keys`}`,
          4000,
        )
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Localness: could not push: ${describeError(error, client.baseUrl)}`,
      )
    } finally {
      await refresh()
    }
  }

  const nodeEntries = (
    node: Node | undefined,
    kinds: readonly DiffKind[],
    take: (entry: DiffEntry) => boolean,
  ) => {
    if (!node) {
      return (provider.comparison?.entries ?? []).filter((entry) =>
        kinds.includes(entry.kind),
      )
    }
    return (node.type === 'group' ? node.entries : [node.entry]).filter(take)
  }

  const openFile = async (entry: DiffEntry) => {
    const own = (provider.comparison?.files ?? []).filter(
      (one) => one.locale === entry.locale,
    )
    const holding = own.filter((one) =>
      entry.locations.some((place) => place.relativePath === one.relativePath),
    )
    const candidates =
      holding.length > 0 ? holding : own.filter((one) => one.source !== null)
    const file =
      candidates.length > 1
        ? (
            await vscode.window.showQuickPick(
              candidates.map((one) => ({ label: one.relativePath, file: one })),
              { placeHolder: `${entry.key} is in several files` },
            )
          )?.file
        : candidates[0]
    if (file) await showKeyInFile(file.path, entry.key)
  }

  const compare = async (node: Node) => {
    if (node.type !== 'entry') return
    const { entry } = node
    const name = `${entry.key} (${entry.locale})`
    await vscode.commands.executeCommand(
      'vscode.diff',
      texts.uri(`Remote · ${name}`, entry.draft ?? entry.platform),
      texts.uri(`Locale file · ${name}`, entry.local),
      `${name}: remote ↔ locale file`,
      { preview: true },
    )
  }

  const openInProject = (node: Node) => {
    if (node.type !== 'entry') return
    const state = controller.data?.keys.find(
      (one) => one.key === node.entry.key,
    )
    if (state)
      void vscode.commands.executeCommand('localness.openKey', state.id)
  }

  const onChange = () => {
    follow()
    schedule()
  }
  onChange()
  return vscode.Disposable.from(
    view,
    vscode.workspace.registerTextDocumentContentProvider(TEXT_SCHEME, texts),
    controller.onDidChange(onChange),
    vscode.commands.registerCommand('localness.sync.refresh', refresh),
    vscode.commands.registerCommand('localness.sync.pull', (node?: Node) =>
      pull(nodeEntries(node, PULL_KINDS, pullable)),
    ),
    vscode.commands.registerCommand('localness.sync.push', (node?: Node) =>
      push(nodeEntries(node, PUSH_KINDS, pushable)),
    ),
    vscode.commands.registerCommand(
      'localness.sync.pushKey',
      (arg: string | { key: string }) => {
        const key = typeof arg === 'string' ? arg : arg.key
        return push(
          (provider.comparison?.entries ?? []).filter(
            (entry) => entry.key === key && pushable(entry),
          ),
        )
      },
    ),
    vscode.commands.registerCommand('localness.sync.compare', compare),
    vscode.commands.registerCommand('localness.sync.openFile', (node: Node) =>
      node.type === 'entry' ? openFile(node.entry) : undefined,
    ),
    vscode.commands.registerCommand(
      'localness.sync.openInProject',
      openInProject,
    ),
    vscode.commands.registerCommand('localness.sync.runCli', async () => {
      const root = controller.config?.root
      if (!root) return
      const picked = await vscode.window.showQuickPick(
        [
          { label: 'diff', detail: 'List the differences' },
          {
            label: 'push',
            detail: 'Plan pushing local changes, to review and apply later',
          },
          { label: 'apply', detail: 'List the saved push plans' },
        ],
        {
          placeHolder:
            'Runs the Localness CLI, which reads LOCALNESS_TOKEN from .env.local',
        },
      )
      if (picked) runInTerminal(root, picked.label)
    }),
    {
      dispose: () => {
        clearTimeout(timer)
        generation += 1
        watcher?.dispose()
      },
    },
  )
}
