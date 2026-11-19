import * as vscode from 'vscode'
import { findRelease, type DeliveryKeyState } from '@localness/sdk'
import { writeConfigFields, type ReleaseRef } from '@localness/sdk/sync'
import type { DataController } from './controller'
import { describeError } from './core/errors'
import { releaseChanges } from './core/releases'

/**
 * The release keys created now are labelled with; null for none. Undefined,
 * after telling the user, when the config names a release the project lacks.
 */
export function releaseForNewKeys(
  controller: DataController,
): ReleaseRef | null | undefined {
  const data = controller.data
  if (!data?.missingRelease) return data?.release ?? null
  const select = 'Select release'
  void vscode.window
    .showErrorMessage(
      `Localness: the project has no release "${data.missingRelease}", which localness.config.json names for new keys.`,
      select,
    )
    .then((choice) => {
      if (choice === select) {
        void vscode.commands.executeCommand('localness.selectRelease')
      }
    })
  return undefined
}

async function useRelease(controller: DataController, name: string | null) {
  const path = controller.config?.path
  if (!path) return
  await writeConfigFields(path, { release: name ?? undefined })
  await controller.reload(true)
}

async function createRelease(controller: DataController) {
  const { client, data } = controller
  if (!client || !data) return
  const name = await vscode.window.showInputBox({
    prompt: 'New release; keys created from now on are labelled with it',
    placeHolder: 'e.g. v2.4',
    validateInput: (value) =>
      !value.trim()
        ? 'Enter a name'
        : findRelease(data.releases, value)
          ? 'The project already has this release'
          : undefined,
  })
  if (!name) return
  try {
    const release = await client.createRelease(name.trim())
    await useRelease(controller, release.name)
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Localness: could not create the release: ${describeError(error, client.baseUrl)}`,
    )
  }
}

type PickItem = vscode.QuickPickItem & { run?: () => Promise<unknown> }

async function selectRelease(controller: DataController) {
  const data = controller.data
  if (!data) {
    void vscode.window.showWarningMessage('Localness: no project data loaded.')
    return
  }
  const current = data.release?.id
  const items: PickItem[] = [
    ...data.releases.map((release) => ({
      label: `${Number(release.id) === current ? '$(pass-filled)' : '$(circle-large-outline)'} ${release.name}`,
      run: () => useRelease(controller, release.name),
    })),
    {
      label: `${current === undefined && !data.missingRelease ? '$(pass-filled)' : '$(circle-large-outline)'} None`,
      description: 'New keys get no release',
      run: () => useRelease(controller, null),
    },
  ]
  if (data.canManageReleases) {
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(add) New release…', run: () => createRelease(controller) },
    )
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Release for new keys',
    placeHolder:
      'Keys you extract or push are labelled with it; existing keys keep theirs',
  })
  await picked?.run?.()
}

/** The keys behind a hover link (`{ key }`) or Keys view nodes. */
function keysOf(
  controller: DataController,
  arg: unknown,
  selected: unknown,
): DeliveryKeyState[] {
  const data = controller.data
  if (!data) return []
  const nodes =
    Array.isArray(selected) && selected.length > 0 ? selected : [arg]
  const states = new Map<number, DeliveryKeyState>()
  for (const node of nodes as Array<Record<string, any> | undefined>) {
    const found: DeliveryKeyState[] =
      node?.type === 'group'
        ? node.group.items.flatMap((item: { state?: DeliveryKeyState }) =>
            item.state ? [item.state] : [],
          )
        : node?.state
          ? [node.state]
          : typeof node?.key === 'string' && data.index.get(node.key)
            ? [data.index.get(node.key)!]
            : []
    for (const state of found) states.set(state.id, state)
  }
  return [...states.values()]
}

async function editReleases(
  controller: DataController,
  arg: unknown,
  selected: unknown,
) {
  const { client, data } = controller
  const keys = keysOf(controller, arg, selected)
  if (!client || !data || keys.length === 0) return
  if (data.releases.length === 0) {
    void vscode.window.showInformationMessage(
      `Localness: the project has no releases${data.canManageReleases ? '; "Select release" can create one' : ''}.`,
    )
    return
  }
  const items = data.releases.map((release) => {
    const id = Number(release.id)
    const having = keys.filter((state) => state.releaseIds.includes(id)).length
    return {
      label: release.name,
      description:
        having > 0 && having < keys.length
          ? `on ${having} of ${keys.length} keys; select to add to all`
          : undefined,
      picked: having === keys.length,
      id,
    }
  })
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title:
      keys.length === 1
        ? `Releases of ${keys[0]!.key}`
        : `Releases of ${keys.length} keys`,
    placeHolder: 'Labels on the key in Localness; the text is not changed',
  })
  if (!picked) return
  const changes = releaseChanges(
    keys,
    items.map((item) => item.id),
    new Set(picked.map((item) => item.id)),
  )
  if (changes.length === 0) return
  try {
    for (const change of changes) await client.setReleaseMembership(change)
    const { keys: states } = await client.keyStates({
      keys: keys.map((state) => state.key),
    })
    for (const state of states) controller.applyKeyState(state)
    vscode.window.setStatusBarMessage(
      `Localness: updated the releases of ${keys.length === 1 ? keys[0]!.key : `${keys.length} keys`}`,
      4000,
    )
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Localness: could not update releases: ${describeError(error, client.baseUrl)}`,
    )
    await controller.reload(true)
  }
}

export function registerReleases(controller: DataController) {
  const register = vscode.commands.registerCommand
  return vscode.Disposable.from(
    register('localness.selectRelease', () => selectRelease(controller)),
    register('localness.editReleases', (arg?: unknown, selected?: unknown) =>
      editReleases(controller, arg, selected),
    ),
  )
}
