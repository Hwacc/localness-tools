import * as vscode from 'vscode'
import type { DataController } from './controller'
import type { ProjectData } from './core/data'
import {
  buildHoverInfo,
  renderHoverMarkdown,
  type HoverInfo,
} from './core/hover'
import { keyUrl } from './core/urls'
import type { DeliveryKeyState } from '@localness/sdk'
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
      baseUrl: controller.client?.baseUrl ?? readSettings().baseUrl,
      projectId: data.projectId,
      keyId: state.id,
    }),
  })
}

export function hoverMarkdown(info: HoverInfo) {
  const markdown = new vscode.MarkdownString(renderHoverMarkdown(info))
  markdown.supportThemeIcons = true
  return markdown
}

export function registerHover(
  controller: DataController,
  matcher: KeyMatcher,
): vscode.Disposable {
  const provider: vscode.HoverProvider = {
    provideHover(document, position) {
      const data = controller.data
      if (!data) return undefined
      const hit = matcher
        .keysIn(document)
        .find((match) => match.range.contains(position))
      const state = hit && data.index.get(hit.key)
      if (!hit || !state) return undefined
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
