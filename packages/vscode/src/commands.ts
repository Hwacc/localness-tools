import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { createClient } from '@localness/sdk'
import { CONFIG_FILE_NAME } from '@localness/sdk/sync'
import { findProjectConfig, tokenKey, type DataController } from './controller'
import { projectSetting } from './core/data'
import { describeError } from './core/errors'
import { localeIcon, localeName } from './core/locales'
import { withProject } from './core/projectConfig'
import { isValidBaseUrl, keyUrl, trimBaseUrl } from './core/urls'
import { editTranslation } from './edit'
import type { KeyMatcher } from './matcher'
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

/** The config file to use, or where to create one: the active file's workspace folder. */
async function configPath(): Promise<string | undefined> {
  const found = await findProjectConfig()
  if (found) return found
  const folders = vscode.workspace.workspaceFolders ?? []
  const uri = vscode.window.activeTextEditor?.document.uri
  const folder =
    (uri && vscode.workspace.getWorkspaceFolder(uri)) ??
    (folders.length === 1
      ? folders[0]
      : await vscode.window.showWorkspaceFolderPick({
          placeHolder: `Folder for ${CONFIG_FILE_NAME}`,
        }))
  if (!folder) {
    if (folders.length === 0) {
      void vscode.window.showErrorMessage(
        `Localness: open a folder first; the project is saved in ${CONFIG_FILE_NAME}.`,
      )
    }
    return undefined
  }
  return join(folder.uri.fsPath, CONFIG_FILE_NAME)
}

async function readSource(path: string) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function saveProject(
  path: string,
  baseUrl: string,
  project: string | number,
) {
  const source = await readSource(path)
  const next = withProject(source, baseUrl, project)
  if (next !== source) await writeFile(path, next, 'utf8')
}

async function signIn(
  controller: DataController,
  secrets: vscode.SecretStorage,
) {
  const path = await configPath()
  if (!path) return
  const current =
    controller.config?.path === path ? controller.config.config : undefined
  let baseUrl = current?.baseUrl ?? ''
  let project = current?.project
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
    if (project === undefined) {
      const { projects } = await createClient({ baseUrl, token }).projects()
      const picked = await pickProject(projects)
      if (!picked) return
      project = projectSetting(projects, picked)
    }
    await createClient({ baseUrl, token, project }).meta()
    await secrets.store(tokenKey(baseUrl), token)
    await saveProject(path, baseUrl, project)
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Localness: ${describeError(error, baseUrl)}`,
    )
    return
  }
  await controller.reload(true)
  void vscode.window.showInformationMessage(
    `Localness: signed in. The project is saved in ${vscode.workspace.asRelativePath(path)}.`,
  )
}

async function selectProject(
  controller: DataController,
  secrets: vscode.SecretStorage,
) {
  const loaded = controller.config
  const baseUrl = loaded?.config.baseUrl
  const token = baseUrl && (await secrets.get(tokenKey(baseUrl)))
  if (!loaded || !token) return signIn(controller, secrets)
  try {
    const { projects } = await createClient({ baseUrl, token }).projects()
    const picked = await pickProject(projects)
    if (!picked) return
    await saveProject(loaded.path, baseUrl, projectSetting(projects, picked))
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Localness: ${describeError(error, baseUrl)}`,
    )
    return
  }
  await controller.reload(true)
}

type LocaleData = NonNullable<DataController['data']>

function localeItem(
  locale: string,
  data: LocaleData,
  extensionUri: vscode.Uri,
) {
  const icon = localeIcon(locale)
  return {
    label: localeName(locale),
    description: [locale, locale === data.sourceLocale ? 'source' : '']
      .filter(Boolean)
      .join(' · '),
    iconPath: icon
      ? vscode.Uri.joinPath(extensionUri, icon)
      : new vscode.ThemeIcon('globe'),
  }
}

async function switchDisplayLocale(
  controller: DataController,
  extensionUri: vscode.Uri,
) {
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
    data.locales.map((locale) => {
      const item = localeItem(locale, data, extensionUri)
      return {
        ...item,
        label:
          locale === data.displayLocale ? `${item.label} $(check)` : item.label,
        locale,
      }
    }),
    { placeHolder: 'Display locale', matchOnDescription: true },
  )
  if (picked) await updateSetting('displayLocale', picked.locale)
}

const HINT_MODE_DETAILS: Record<InlineHintMode, string> = {
  inline: 'Translation after the key',
  replace: 'Translation in place of the key',
  off: 'No inline hints',
}

async function switchInlineHintMode() {
  const current = readSettings().inlineHints
  const picked = await vscode.window.showQuickPick(
    INLINE_HINT_MODES.map((mode) => ({
      label: mode,
      detail: HINT_MODE_DETAILS[mode],
      description: mode === current ? 'current' : '',
    })),
    { placeHolder: 'Inline hint mode' },
  )
  if (picked) await updateSetting('inlineHints', picked.label)
}

type MenuItem = vscode.QuickPickItem & {
  run?: () => Thenable<unknown> | Promise<unknown>
}

const SEPARATOR = vscode.QuickPickItemKind.Separator

function radio(selected: boolean) {
  return selected ? '$(pass-filled)' : '$(circle-large-outline)'
}

function accountItems(): MenuItem[] {
  const run = (command: string) => () => vscode.commands.executeCommand(command)
  return [
    {
      label: '$(project) Select project',
      run: run('localness.selectProject'),
    },
    { label: '$(key) Sign in', run: run('localness.signIn') },
    { label: '$(sign-out) Sign out', run: run('localness.signOut') },
  ]
}

function showMenu(controller: DataController, extensionUri: vscode.Uri) {
  const { status, data } = controller
  const settings = readSettings()
  const pick = vscode.window.createQuickPick<MenuItem>()
  const searchButton = {
    iconPath: new vscode.ThemeIcon('search'),
    tooltip: 'Search keys',
  }
  const refreshButton = {
    iconPath: new vscode.ThemeIcon('refresh'),
    tooltip: 'Refresh',
  }
  const accountButton = {
    iconPath: new vscode.ThemeIcon('gear'),
    tooltip: 'Project and account',
  }
  const title = data ? `Localness · ${data.projectName}` : 'Localness'
  const placeholder =
    status.kind === 'error' || status.kind === 'unconfigured'
      ? status.message
      : 'Type to filter'

  const showAccount = (back: boolean) => {
    pick.title = back ? `${title} · Project and account` : title
    pick.placeholder = back ? '' : placeholder
    pick.buttons = back ? [vscode.QuickInputButtons.Back] : []
    pick.items = accountItems()
  }

  const showMain = () => {
    if (!data) return showAccount(false)
    const locales: MenuItem[] = data.locales.map((locale) => {
      const item = localeItem(locale, data, extensionUri)
      return {
        ...item,
        label: `${radio(locale === data.displayLocale)} ${item.label}`,
        run: () => updateSetting('displayLocale', locale),
      }
    })
    pick.title = title
    pick.placeholder = placeholder
    pick.buttons = [searchButton, refreshButton, accountButton]
    pick.matchOnDescription = true
    pick.items = [
      { label: 'Display locale', kind: SEPARATOR },
      ...locales,
      { label: 'Hint mode', kind: SEPARATOR },
      ...INLINE_HINT_MODES.map((mode) => ({
        label: `${radio(mode === settings.inlineHints)} ${mode}`,
        description: HINT_MODE_DETAILS[mode],
        run: () => updateSetting('inlineHints', mode),
      })),
    ]
    const current = locales[data.locales.indexOf(data.displayLocale)]
    if (current) pick.activeItems = [current]
  }

  const runCommand = (command: string) => {
    pick.hide()
    void vscode.commands.executeCommand(command)
  }
  pick.onDidTriggerButton((button) => {
    if (button === searchButton) runCommand('localness.searchKeys')
    else if (button === refreshButton) runCommand('localness.refresh')
    else if (button === accountButton) showAccount(true)
    else if (button === vscode.QuickInputButtons.Back) showMain()
  })
  pick.onDidAccept(() => {
    const [item] = pick.selectedItems
    pick.hide()
    void item?.run?.()
  })
  pick.onDidHide(() => pick.dispose())
  showMain()
  pick.show()
}

export function registerCommands(
  controller: DataController,
  matcher: KeyMatcher,
  { secrets, extensionUri }: vscode.ExtensionContext,
): vscode.Disposable {
  const register = vscode.commands.registerCommand
  return vscode.Disposable.from(
    register('localness.editTranslation', (arg?: unknown) =>
      editTranslation(controller, matcher, arg),
    ),
    register('localness.copyKey', async (arg?: { key?: unknown }) => {
      if (typeof arg?.key !== 'string') return
      await vscode.env.clipboard.writeText(arg.key)
      vscode.window.setStatusBarMessage(`Copied ${arg.key}`, 2000)
    }),
    register('localness.signIn', () => signIn(controller, secrets)),
    register('localness.signOut', async () => {
      const baseUrl = controller.config?.config.baseUrl
      if (baseUrl) await secrets.delete(tokenKey(baseUrl))
      await controller.reload(true)
    }),
    register('localness.selectProject', () =>
      selectProject(controller, secrets),
    ),
    register('localness.switchDisplayLocale', () =>
      switchDisplayLocale(controller, extensionUri),
    ),
    register('localness.switchInlineHintMode', switchInlineHintMode),
    register('localness.refresh', () => controller.reload(true)),
    register('localness.searchKeys', () => searchKeys(controller)),
    register('localness.showMenu', () => showMenu(controller, extensionUri)),
    register('localness.openKey', async (keyId: number) => {
      const data = controller.data
      if (!data) return
      await vscode.env.openExternal(
        vscode.Uri.parse(
          keyUrl({
            baseUrl: controller.baseUrl,
            projectId: data.projectId,
            keyId,
          }),
        ),
      )
    }),
  )
}
