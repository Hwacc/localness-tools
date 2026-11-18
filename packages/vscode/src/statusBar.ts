import * as vscode from 'vscode'
import type { DataController } from './controller'
import type { LocalChanges } from './localChanges'

const LINKED_COMMANDS = [
  'localness.switchDisplayLocale',
  'localness.selectRelease',
  'localness.sync.focus',
  'localness.sync.push',
]

function link(label: string, command: string) {
  return `[${label}](command:${command})`
}

/** One item for the project, display locale, release for new keys and local changes. */
export function registerStatusBar(
  controller: DataController,
  changes: LocalChanges,
) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0,
  )
  item.name = 'Localness'
  item.command = 'localness.showMenu'

  const render = () => {
    const { status, data } = controller
    if (status.kind === 'unconfigured') {
      item.text = `$(globe) Localness: ${status.message}`
      item.tooltip = 'Localness: click to configure'
      return
    }
    const parts = [data?.displayLocale ?? 'Localness']
    const release = data?.missingRelease ?? data?.release?.name
    if (release) parts.push(`$(tag) ${release}`)
    if (changes.count > 0) parts.push(`$(git-compare) ${changes.count}`)
    const icon =
      status.kind === 'loading'
        ? '$(sync~spin)'
        : status.kind === 'error' || data?.missingRelease
          ? '$(warning)'
          : '$(globe)'
    item.text = `${icon} ${parts.join('  ')}`

    const lines = [`**Localness**${data ? ` · ${data.projectName}` : ''}`]
    if (status.kind === 'error') lines.push(`$(warning) ${status.message}`)
    if (status.kind === 'loading') lines.push('Loading…')
    if (data) {
      lines.push(
        `$(globe) Display locale: ${data.displayLocale} · ${link('Switch', 'localness.switchDisplayLocale')}`,
      )
      const releaseText = data.missingRelease
        ? `$(warning) "${data.missingRelease}" is not in the project`
        : (data.release?.name ?? 'none')
      lines.push(
        `$(tag) Release for new keys: ${releaseText} · ${link('Change', 'localness.selectRelease')}`,
      )
    }
    if (changes.count > 0) {
      const actions = [link('Review', 'localness.sync.focus')]
      if (changes.pushable > 0) {
        actions.push(link(`Push ${changes.pushable}`, 'localness.sync.push'))
      }
      lines.push(
        `$(git-compare) ${changes.count} locale-file ${changes.count === 1 ? 'text differs' : 'texts differ'} · ${actions.join(' · ')}`,
      )
    }
    const tooltip = new vscode.MarkdownString(lines.join('\n\n'))
    tooltip.supportThemeIcons = true
    tooltip.isTrusted = { enabledCommands: LINKED_COMMANDS }
    item.tooltip = tooltip
  }

  render()
  item.show()
  return vscode.Disposable.from(
    item,
    controller.onDidChange(render),
    changes.onDidChange(render),
  )
}
