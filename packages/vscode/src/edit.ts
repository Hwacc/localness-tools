import * as vscode from 'vscode'
import {
  draftConflictOf,
  type DeliveryKeyState,
  type LocalnessClient,
} from '@localness/sdk'
import type { DataController } from './controller'
import type { ProjectData } from './core/data'
import { describeError } from './core/errors'
import { editableText, textFor, truncate } from './core/keys'
import { localeName } from './core/locales'
import type { KeyMatcher } from './matcher'

export interface EditTarget {
  key: string
  locale?: string
}

/** Hover links pass `{ key, locale }`; the key tree passes its node, `{ state }`. */
function targetOf(arg: unknown): EditTarget | undefined {
  if (typeof arg !== 'object' || arg === null) return undefined
  const record = arg as {
    key?: unknown
    locale?: unknown
    state?: { key?: unknown }
  }
  const key = typeof record.key === 'string' ? record.key : record.state?.key
  if (typeof key !== 'string') return undefined
  return {
    key,
    locale: typeof record.locale === 'string' ? record.locale : undefined,
  }
}

function keyAtCursor(matcher: KeyMatcher): string | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor || !matcher.isSupported(editor.document)) return undefined
  const position = editor.selection.active
  return matcher
    .keysIn(editor.document)
    .find((match) => match.range.contains(position))?.key
}

async function pickKey(data: ProjectData) {
  const picked = await vscode.window.showQuickPick(
    data.keys.map((state) => ({
      label: state.key,
      description: textFor(state, data.displayLocale),
      detail: textFor(state, data.sourceLocale),
      key: state.key,
    })),
    {
      placeHolder: 'Key to edit',
      matchOnDescription: true,
      matchOnDetail: true,
    },
  )
  return picked?.key
}

/** Source and display locale first, then the rest in project order. */
async function pickLocale(data: ProjectData, state: DeliveryKeyState) {
  const locales = [
    ...new Set([
      data.sourceLocale,
      data.displayLocale,
      ...data.locales,
      ...Object.keys(state.locales),
    ]),
  ]
  const picked = await vscode.window.showQuickPick(
    locales.map((locale) => ({
      label: localeName(locale),
      description: [locale, locale === data.sourceLocale ? 'source' : '']
        .filter(Boolean)
        .join(' · '),
      detail: textFor(state, locale) || '(no text)',
      locale,
    })),
    {
      placeHolder: `Locale of ${state.key} to edit`,
      matchOnDescription: true,
    },
  )
  return picked?.locale
}

/** Every locale of one key, fresh: the draft an edit replaces must be current. */
async function freshState(client: LocalnessClient, key: string) {
  const { keys } = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `Localness: loading ${key}`,
    },
    () => client.keyStates({ keys: [key] }),
  )
  return keys.find((state) => state.key === key)
}

function openKeyLater(message: string, keyId: number) {
  void vscode.window
    .showInformationMessage(message, 'Open in Localness')
    .then((choice) => {
      if (choice) {
        void vscode.commands.executeCommand('localness.openKey', keyId)
      }
    })
}

async function editLocale(
  controller: DataController,
  client: LocalnessClient,
  state: DeliveryKeyState,
  locale: string,
  isSource: boolean,
) {
  const label = `${state.key} (${locale})`
  const notes = ['Saved as a draft; publish it in Localness.']
  if (isSource) notes.push('Translations will be marked outdated.')
  let current = state
  let mine: string | undefined

  for (;;) {
    const { text, expected } = editableText(current, locale)
    if (/[\r\n]/.test(text)) {
      openKeyLater(
        `Localness: ${label} has several lines. Edit it in Localness.`,
        state.id,
      )
      return
    }
    mine = await vscode.window.showInputBox({
      title: `Edit ${state.key} · ${localeName(locale)}`,
      prompt: notes.join(' '),
      value: mine ?? text,
      ignoreFocusOut: true,
      validateInput: (value) =>
        isSource && !value.trim() ? 'The source text cannot be empty.' : '',
    })
    if (mine === undefined || mine === text) return

    try {
      const result = await client.updateKey({
        key: state.key,
        locales: { [locale]: { text: mine, expected } },
      })
      controller.applyKeyState(result.key)
      openKeyLater(`Localness: saved a draft of ${label}.`, state.id)
      return
    } catch (error) {
      const conflict = draftConflictOf(error)
      if (!conflict) {
        void vscode.window.showErrorMessage(
          `Localness: ${describeError(error, client.baseUrl)}`,
        )
        return
      }
      controller.applyKeyState(conflict.key)
      current = conflict.key
      const theirs = editableText(current, locale).text
      const choice = await vscode.window.showWarningMessage(
        `${label} changed in Localness since it was loaded.`,
        {
          modal: true,
          detail: `It now reads: "${truncate(theirs, 200)}"\n\nEdit again to compare and save your text over it.`,
        },
        'Edit again',
      )
      if (choice !== 'Edit again') return
    }
  }
}

export async function editTranslation(
  controller: DataController,
  matcher: KeyMatcher,
  arg?: unknown,
) {
  const { data, client } = controller
  if (!data || !client) {
    void vscode.window.showWarningMessage(
      'Localness: sign in and select a project first.',
    )
    return
  }
  const target = targetOf(arg)
  const key = target?.key ?? keyAtCursor(matcher) ?? (await pickKey(data))
  if (!key) return
  let state: DeliveryKeyState | undefined
  try {
    state = await freshState(client, key)
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Localness: ${describeError(error, client.baseUrl)}`,
    )
    return
  }
  if (!state) {
    void vscode.window.showWarningMessage(
      `Localness: "${key}" is not in ${data.projectName}.`,
    )
    return
  }
  controller.applyKeyState(state)
  const locale = target?.locale ?? (await pickLocale(data, state))
  if (!locale) return
  await editLocale(
    controller,
    client,
    state,
    locale,
    locale === data.sourceLocale,
  )
}
