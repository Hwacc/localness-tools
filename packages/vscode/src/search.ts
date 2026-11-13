import * as vscode from 'vscode'
import type { DataController } from './controller'
import { describeError } from './core/errors'
import { STATE_ICONS, searchCached, stateFor, textFor } from './core/keys'
import { readSettings } from './settings'

const LOCAL_LIMIT = 50
const REMOTE_LIMIT = 100

interface HitItem extends vscode.QuickPickItem {
  keyId: number
}

export async function searchKeys(controller: DataController) {
  const data = controller.data
  const client = controller.client
  if (!client) {
    void vscode.window.showWarningMessage(
      'Localness: sign in and select a project first.',
    )
    return
  }

  const pick = vscode.window.createQuickPick<HitItem>()
  pick.placeholder = 'Search translation keys and source text'
  pick.matchOnDetail = true
  pick.matchOnDescription = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let sequence = 0

  const search = async (query: string) => {
    const current = ++sequence
    const items = new Map<number, HitItem>()
    let needsRemote = !data
    if (data) {
      const local = searchCached(data.keys, query, {
        sourceLocale: data.sourceLocale,
        displayLocale: data.displayLocale,
        limit: LOCAL_LIMIT,
      })
      for (const state of local) {
        items.set(state.id, {
          keyId: state.id,
          label: `$(${STATE_ICONS[stateFor(state, data.displayLocale)]}) ${state.key}`,
          description: textFor(state, data.displayLocale),
          detail: textFor(state, data.sourceLocale),
          alwaysShow: true,
        })
      }
      needsRemote = local.length >= LOCAL_LIMIT
    }
    pick.items = [...items.values()]
    if (!needsRemote || !query.trim()) return

    pick.busy = true
    try {
      const result = await client.searchKeys(query.trim(), {
        limit: REMOTE_LIMIT,
      })
      if (current !== sequence) return
      for (const hit of result.keys) {
        if (!items.has(hit.id)) {
          items.set(hit.id, {
            keyId: hit.id,
            label: `$(${hit.draft ? 'edit' : 'check'}) ${hit.key}`,
            detail: hit.sourceText,
            alwaysShow: true,
          })
        }
      }
      pick.items = [...items.values()]
    } catch (error) {
      if (current === sequence) {
        void vscode.window.showWarningMessage(
          `Localness: ${describeError(error, readSettings().baseUrl)}`,
        )
      }
    } finally {
      if (current === sequence) pick.busy = false
    }
  }

  pick.onDidChangeValue((value) => {
    clearTimeout(timer)
    timer = setTimeout(() => void search(value), 200)
  })
  pick.onDidAccept(() => {
    const [selected] = pick.selectedItems
    pick.hide()
    if (selected) {
      void vscode.commands.executeCommand('localness.openKey', selected.keyId)
    }
  })
  pick.onDidHide(() => {
    clearTimeout(timer)
    pick.dispose()
  })
  pick.show()
}
