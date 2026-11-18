import * as vscode from 'vscode'
import {
  LocalnessError,
  type CaptureMatch,
  type DeliveryKeyState,
  type LocalnessClient,
} from '@localness/sdk'
import type { DataController } from './controller'
import {
  locateExtraction,
  mergeExtractTemplates,
  renderExtraction,
  type ExtractSite,
  type ExtractTemplates,
} from './core/extractText'
import { describeError } from './core/errors'
import { stateFor, truncate } from './core/keys'
import { pullKey } from './localFiles'
import type { KeyMatcher } from './matcher'
import { releaseForNewKeys } from './releases'

const COMMAND = 'localness.extractText'
const UNNAMED_PREFIX = '__unnamed_'

type KeyHit = CaptureMatch['matches'][number]['keys'][number]

function showError(error: unknown, baseUrl: string) {
  void vscode.window.showErrorMessage(
    `Localness: ${describeError(error, baseUrl)}`,
  )
}

function siteIn(document: vscode.TextDocument, range: vscode.Range) {
  return locateExtraction(
    document.getText(),
    document.offsetAt(range.start),
    document.offsetAt(range.end),
    document.languageId,
  )
}

/** An existing key with the same source text, `null` for a new key, undefined when cancelled. */
async function pickExisting(hits: readonly KeyHit[]) {
  const create = { label: '$(add) Create a new key', hit: null }
  const picked = await vscode.window.showQuickPick(
    [
      ...hits.map((hit) => ({
        label: `$(link) ${hit.key}`,
        description: hit.draft ? 'draft' : '',
        detail: truncate(hit.sourceText, 120),
        hit,
      })),
      create,
    ],
    { placeHolder: 'Keys with this text already exist. Reuse one?' },
  )
  return picked?.hit
}

function validateName(value: string) {
  const name = value.trim()
  if (/[\s'"`]/.test(name)) return 'Key names cannot contain spaces or quotes.'
  if (name.startsWith(UNNAMED_PREFIX)) {
    return `${UNNAMED_PREFIX} is reserved for unnamed keys.`
  }
  return ''
}

/** The typed name, `''` for an unnamed draft, undefined when cancelled. */
function askName(client: LocalnessClient, text: string, value = '') {
  const input = vscode.window.createInputBox()
  const suggest = {
    iconPath: new vscode.ThemeIcon('sparkle'),
    tooltip: 'Suggest a name with AI',
  }
  const prompt =
    'Leave empty to save an unnamed draft and name it in Localness.'
  input.title = `Extract "${truncate(text, 60)}"`
  input.placeholder = 'Key name'
  input.prompt = prompt
  input.value = value
  input.ignoreFocusOut = true
  input.buttons = [suggest]

  return new Promise<string | undefined>((resolve) => {
    let result: string | undefined
    input.onDidChangeValue((next) => {
      input.validationMessage = validateName(next) || undefined
    })
    input.onDidTriggerButton(async () => {
      input.busy = true
      input.enabled = false
      try {
        const suggestion = await client.suggestKeyName(text)
        if (suggestion.key) {
          input.value = suggestion.key
          input.validationMessage = validateName(suggestion.key) || undefined
        }
        const others = (suggestion.alternatives ?? [])
          .map((alternative) => alternative.key)
          .filter((key) => key !== suggestion.key)
        input.prompt = suggestion.key
          ? [
              suggestion.reason,
              others.length > 0 ? `Also: ${others.join(', ')}` : '',
            ]
              .filter(Boolean)
              .join(' · ') || prompt
          : 'Nothing to name in this text.'
      } catch (error) {
        input.prompt = `Suggestion failed: ${describeError(error, client.baseUrl)}`
      } finally {
        input.busy = false
        input.enabled = true
      }
    })
    input.onDidAccept(() => {
      if (validateName(input.value)) return
      result = input.value.trim()
      input.hide()
    })
    input.onDidHide(() => {
      input.dispose()
      resolve(result)
    })
    input.show()
  })
}

interface ChosenKey {
  key: string
  /** The state `createKey` returned, when it was called. */
  state?: DeliveryKeyState
  /** An existing key the user picked, not one named for this text. */
  reused: boolean
}

/** Names and creates the key, offering the existing key on a name clash. */
async function createNamedKey(
  client: LocalnessClient,
  text: string,
  releaseId: number | undefined,
): Promise<ChosenKey | undefined> {
  let name = ''
  for (;;) {
    const typed = await askName(client, text, name)
    if (typed === undefined) return undefined
    name = typed
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'Localness: creating key',
        },
        () =>
          client.createKey({
            key: name || undefined,
            sourceText: text,
            releaseId,
          }),
      )
      return { key: result.key.key, state: result.key, reused: false }
    } catch (error) {
      if (!(error instanceof LocalnessError) || error.code !== 'conflict') {
        showError(error, client.baseUrl)
        return undefined
      }
      const choice = await vscode.window.showWarningMessage(
        `"${name}" already exists.`,
        { modal: true, detail: error.serverMessage },
        'Use existing key',
        'Rename',
      )
      if (choice === 'Use existing key') return { key: name, reused: true }
      if (choice !== 'Rename') return undefined
    }
  }
}

async function loadState(
  controller: DataController,
  client: LocalnessClient,
  key: string,
) {
  const known = controller.data?.keys.find((state) => state.key === key)
  if (known) return known
  try {
    const { keys } = await client.keyStates({ keys: [key] })
    return keys.find((state) => state.key === key)
  } catch {
    return undefined
  }
}

async function replaceSite(
  templates: ExtractTemplates,
  document: vscode.TextDocument,
  version: number,
  site: ExtractSite,
  key: string,
) {
  if (document.version !== version) {
    void vscode.window.showWarningMessage(
      `Localness: the file changed while extracting; insert ${key} yourself.`,
    )
    return false
  }
  const edit = new vscode.WorkspaceEdit()
  edit.replace(
    document.uri,
    new vscode.Range(
      document.positionAt(site.start),
      document.positionAt(site.end),
    ),
    renderExtraction(templates, site, key),
  )
  return vscode.workspace.applyEdit(edit)
}

function report(
  state: DeliveryKeyState,
  sourceLocale: string,
  reused: boolean,
) {
  const draft = stateFor(state, sourceLocale) !== 'published'
  const unnamed = state.key.startsWith(UNNAMED_PREFIX)
  const message = reused
    ? `Localness: reused ${state.key}.`
    : unnamed
      ? 'Localness: saved an unnamed draft. Name and publish it in Localness; until then the app shows the key name.'
      : draft
        ? `Localness: created ${state.key} as a draft. Publish it in Localness; until then the app shows the key name.`
        : `Localness: created and published ${state.key}.`
  const actions = draft || unnamed ? ['Open in Localness'] : []
  void vscode.window
    .showInformationMessage(message, ...actions)
    .then((choice) => {
      if (choice) {
        void vscode.commands.executeCommand('localness.openKey', state.id)
      }
    })
}

/**
 * Replaces a selected hardcoded string with a key: reuse a key with the same
 * text or create one, then rewrite the code with the site's template.
 */
export async function extractText(
  controller: DataController,
  uri?: vscode.Uri,
  range?: vscode.Range,
) {
  const { data, client } = controller
  if (!data || !client) {
    void vscode.window.showWarningMessage(
      'Localness: sign in and select a project first.',
    )
    return
  }
  const editor = vscode.window.activeTextEditor
  const document =
    uri && uri.toString() !== editor?.document.uri.toString()
      ? await vscode.workspace.openTextDocument(uri)
      : editor?.document
  const selection =
    range ??
    (editor && document === editor.document ? editor.selection : undefined)
  if (!document || !selection) return
  const version = document.version
  const site = siteIn(document, selection)
  if ('error' in site) {
    void vscode.window.showWarningMessage(`Localness: ${site.error}`)
    return
  }

  let hits: readonly KeyHit[]
  try {
    const { matches } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Localness: looking for matching keys',
      },
      () => client.match([site.text]),
    )
    hits = matches[0]?.keys ?? []
  } catch (error) {
    showError(error, client.baseUrl)
    return
  }

  let chosen: ChosenKey | undefined
  if (hits.length > 0) {
    const hit = await pickExisting(hits)
    if (hit === undefined) return
    if (hit) chosen = { key: hit.key, reused: true }
  }
  if (!chosen) {
    const release = releaseForNewKeys(controller)
    if (release === undefined) return
    chosen = await createNamedKey(client, site.text, release?.id)
  }
  if (!chosen) return

  const state =
    chosen.state ?? (await loadState(controller, client, chosen.key))
  if (state) controller.applyKeyState(state)
  // The key exists on the project now, whatever happens to the code edit.
  await pullKey(controller, chosen.key)
  const templates = mergeExtractTemplates(
    controller.config?.config.extractTemplates,
  )
  if (!(await replaceSite(templates, document, version, site, chosen.key))) {
    return
  }
  if (state) report(state, data.sourceLocale, chosen.reused)
}

/** Offers the extraction on a selection that `locateExtraction` accepts. */
export function registerExtractText(
  controller: DataController,
  matcher: KeyMatcher,
): vscode.Disposable {
  const provider: vscode.CodeActionProvider = {
    provideCodeActions(document, range) {
      if (range.isEmpty || !controller.data || !matcher.isSupported(document)) {
        return []
      }
      if ('error' in siteIn(document, range)) return []
      const action = new vscode.CodeAction(
        'Extract to Localness',
        vscode.CodeActionKind.RefactorExtract,
      )
      action.command = {
        command: COMMAND,
        title: 'Extract to Localness',
        arguments: [document.uri, range],
      }
      return [action]
    },
  }
  return vscode.Disposable.from(
    vscode.commands.registerCommand(COMMAND, (uri?: unknown, range?: unknown) =>
      extractText(
        controller,
        uri instanceof vscode.Uri ? uri : undefined,
        range instanceof vscode.Range ? range : undefined,
      ),
    ),
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.RefactorExtract],
    }),
  )
}
