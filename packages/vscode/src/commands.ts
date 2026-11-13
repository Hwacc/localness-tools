import * as vscode from 'vscode'
import { createClient } from '@localness/sdk'
import { tokenKey, type DataController } from './controller'
import { projectSetting } from './core/data'
import { describeError } from './core/errors'
import { isValidBaseUrl, keyUrl, trimBaseUrl } from './core/urls'
import { searchKeys } from './search'
import {
  INLINE_HINT_MODES,
  readSettings,
  updateSetting,
  type InlineHintMode,
} from './settings'

async function pickProject(
  projects: ReadonlyArray<{ id: number; name: string }>,
) {
  if (projects.length === 0) {
    void vscode.window.showErrorMessage(
      'Localness: this token cannot reach any project.',
    )
    return undefined
  }
  if (projects.length === 1) return projects[0]
  const picked = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.name,
      description: `#${project.id}`,
      project,
    })),
    { placeHolder: 'Select the Localness project' },
  )
  return picked?.project
}

async function signIn(
  controller: DataController,
  secrets: vscode.SecretStorage,
) {
  let { baseUrl, project } = readSettings()
  if (!baseUrl) {
    const input = await vscode.window.showInputBox({
      prompt: 'Localness base URL',
      placeHolder: 'https://localness.example.com',
      ignoreFocusOut: true,
      validateInput: (value) =>
        isValidBaseUrl(value) ? undefined : 'Enter an http(s) URL',
    })
    if (!input) return
    baseUrl = trimBaseUrl(input)
  }
  const token = await vscode.window.showInputBox({
    prompt: `Personal access token for ${baseUrl}`,
    password: true,
    ignoreFocusOut: true,
  })
  if (!token) return

  try {
    if (!project) {
      const { projects } = await createClient({ baseUrl, token }).projects()
      const picked = await pickProject(projects)
      if (!picked) return
      project = projectSetting(projects, picked)
    }
    await createClient({ baseUrl, token, project }).meta()
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Localness: ${describeError(error, baseUrl)}`,
    )
    return
  }

  await secrets.store(tokenKey(baseUrl), token)
  await updateSetting('baseUrl', baseUrl)
  await updateSetting('project', project)
  await controller.reload(true)
  void vscode.window.showInformationMessage('Localness: signed in.')
}

async function selectProject(
  controller: DataController,
  secrets: vscode.SecretStorage,
) {
  const { baseUrl } = readSettings()
  const token = baseUrl && (await secrets.get(tokenKey(baseUrl)))
  if (!token) return signIn(controller, secrets)
  try {
    const { projects } = await createClient({ baseUrl, token }).projects()
    const picked = await pickProject(projects)
    if (picked) await updateSetting('project', projectSetting(projects, picked))
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Localness: ${describeError(error, baseUrl)}`,
    )
  }
}

async function switchDisplayLocale(controller: DataController) {
  const data = controller.data
  if (!data) {
    void vscode.window.showWarningMessage('Localness: no project data loaded.')
    return
  }
  if (data.locales.length <= 1) {
    void vscode.window.showInformationMessage(
      `Localness: this project has only the source locale (${data.sourceLocale}).`,
    )
    return
  }
  const picked = await vscode.window.showQuickPick(
    data.locales.map((locale) => ({
      label: locale,
      description: [
        locale === data.displayLocale ? 'current' : '',
        locale === data.sourceLocale ? 'source' : '',
      ]
        .filter(Boolean)
        .join(', '),
    })),
    { placeHolder: 'Display locale' },
  )
  if (picked) await updateSetting('displayLocale', picked.label)
}

async function switchInlineHintMode() {
  const current = readSettings().inlineHints
  const labels: Record<InlineHintMode, string> = {
    inline: 'Inline — show the translation after the key',
    replace: 'Replace — show the translation in place of the key',
    off: 'Off',
  }
  const picked = await vscode.window.showQuickPick(
    INLINE_HINT_MODES.map((mode) => ({
      label: mode,
      detail: labels[mode],
      description: mode === current ? 'current' : '',
    })),
    { placeHolder: 'Inline hint mode' },
  )
  if (picked) await updateSetting('inlineHints', picked.label)
}

async function showMenu(controller: DataController) {
  const status = controller.status
  const actions: Array<vscode.QuickPickItem & { command: string }> = []
  if (status.kind === 'ready' || status.kind === 'error') {
    actions.push(
      {
        label: '$(globe) Switch display locale',
        command: 'localness.switchDisplayLocale',
      },
      {
        label: '$(eye) Switch inline hint mode',
        command: 'localness.switchInlineHintMode',
      },
      { label: '$(refresh) Refresh', command: 'localness.refresh' },
      { label: '$(search) Search keys', command: 'localness.searchKeys' },
    )
  }
  actions.push(
    { label: '$(project) Select project', command: 'localness.selectProject' },
    { label: '$(key) Sign in', command: 'localness.signIn' },
    { label: '$(sign-out) Sign out', command: 'localness.signOut' },
  )
  const picked = await vscode.window.showQuickPick(actions, {
    placeHolder:
      status.kind === 'error' || status.kind === 'unconfigured'
        ? status.message
        : 'Localness',
  })
  if (picked) await vscode.commands.executeCommand(picked.command)
}

export function registerCommands(
  controller: DataController,
  secrets: vscode.SecretStorage,
): vscode.Disposable {
  const register = vscode.commands.registerCommand
  return vscode.Disposable.from(
    register('localness.signIn', () => signIn(controller, secrets)),
    register('localness.signOut', async () => {
      const { baseUrl } = readSettings()
      if (baseUrl) await secrets.delete(tokenKey(baseUrl))
      await controller.reload(true)
    }),
    register('localness.selectProject', () =>
      selectProject(controller, secrets),
    ),
    register('localness.switchDisplayLocale', () =>
      switchDisplayLocale(controller),
    ),
    register('localness.switchInlineHintMode', switchInlineHintMode),
    register('localness.refresh', () => controller.reload(true)),
    register('localness.searchKeys', () => searchKeys(controller)),
    register('localness.showMenu', () => showMenu(controller)),
    register('localness.openKey', async (keyId: number) => {
      const data = controller.data
      if (!data) return
      await vscode.env.openExternal(
        vscode.Uri.parse(
          keyUrl({
            baseUrl: controller.client?.baseUrl ?? readSettings().baseUrl,
            projectId: data.projectId,
            keyId,
          }),
        ),
      )
    }),
  )
}
