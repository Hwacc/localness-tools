import * as vscode from 'vscode'
import type { DataController } from './controller'
import type { ProjectData } from './core/data'
import {
  buildHoverInfo,
  buildLocalHoverInfo,
  buildPrefixHoverInfo,
  renderHoverMarkdown,
  renderPrefixHoverMarkdown,
  type HoverInfo,
} from './core/hover'
import { keyUrl } from './core/urls'
import type { DeliveryKeyState } from '@localness/sdk'
import type { LocalChanges } from './localChanges'
import type { KeyMatcher } from './matcher'
import { readSettings } from './settings'

export function hoverInfoFor(
  controller: DataController,
  data: ProjectData,
  state: DeliveryKeyState,
): HoverInfo {
  return buildHoverInfo(state, {
    sourceLocale: data.sourceLocale,
    displayLocale: data.displayLocale,
    releaseNames: data.releaseNames,
    url: keyUrl({
      baseUrl: controller.baseUrl,
      projectId: data.projectId,
      keyId: state.id,
    }),
  })
}

function commandLink(
  label: string,
  command: string,
  arg: unknown,
  title: string,
) {
  const args = encodeURIComponent(JSON.stringify([arg]))
  return `[${label}](command:${command}?${args} "${title}")`
}

const LOCAL_LINKS = (key: string) => ({
  title: [commandLink('$(copy)', 'localness.copyKey', { key }, 'Copy key')],
  footer: [
    commandLink(
      '$(cloud-upload) Push to remote',
      'localness.sync.pushKey',
      key,
      'Create the key on remote from the locale files',
    ),
  ],
})

export function hoverMarkdown(info: HoverInfo) {
  const { key } = info
  const markdown = new vscode.MarkdownString(
    renderHoverMarkdown(
      info,
      info.url === undefined
        ? LOCAL_LINKS(key)
        : {
            edit: (locale) =>
              commandLink(
                '$(edit)',
                'localness.editTranslation',
                { key, locale },
                `Edit ${locale}`,
              ),
            title: [
              commandLink('$(copy)', 'localness.copyKey', { key }, 'Copy key'),
            ],
            footer: [
              commandLink(
                '$(globe) Other locales…',
                'localness.editTranslation',
                { key },
                'Edit any locale of this key',
              ),
              commandLink(
                '$(tag) Releases…',
                'localness.editReleases',
                { key },
                'Edit the releases this key is labelled with',
              ),
            ],
          },
    ),
  )
  markdown.supportThemeIcons = true
  markdown.supportHtml = true
  markdown.isTrusted = {
    enabledCommands: [
      'localness.editTranslation',
      'localness.copyKey',
      'localness.editReleases',
      'localness.sync.pushKey',
    ],
  }
  return markdown
}

export function registerHover(
  controller: DataController,
  matcher: KeyMatcher,
  changes: LocalChanges,
): vscode.Disposable {
  const provider: vscode.HoverProvider = {
    provideHover(document, position) {
      const data = controller.data
      if (!data) return undefined
      const hit = matcher
        .keysIn(document)
        .find((match) => match.range.contains(position))
      if (!hit) return undefined
      const state = data.index.get(hit.key)
      if (!state) {
        const local = changes.localOnly.get(hit.key)
        if (local) {
          return new vscode.Hover(
            hoverMarkdown(buildLocalHoverInfo(hit.key, local, data)),
            hit.range,
          )
        }
        const prefix = buildPrefixHoverInfo(
          hit.key,
          data.index,
          changes.localOnly,
          data.displayLocale,
        )
        if (!prefix) return undefined
        const markdown = new vscode.MarkdownString(
          renderPrefixHoverMarkdown(prefix),
        )
        markdown.supportThemeIcons = true
        markdown.supportHtml = true
        return new vscode.Hover(markdown, hit.range)
      }
      return new vscode.Hover(
        hoverMarkdown(hoverInfoFor(controller, data, state)),
        hit.range,
      )
    },
  }

  let registration: vscode.Disposable | undefined
  const register = () => {
    registration?.dispose()
    registration = vscode.languages.registerHoverProvider(
      readSettings().languages.map((language) => ({ language })),
      provider,
    )
  }
  register()
  return vscode.Disposable.from(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('localness.languages')) register()
    }),
    { dispose: () => registration?.dispose() },
  )
}
