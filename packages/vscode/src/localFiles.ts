import * as vscode from 'vscode'
import {
  FORCED_PULL_KINDS,
  PULL_KINDS,
  compareLocaleFiles,
  pullLocaleFiles,
  readLocalFiles,
} from '@localness/sdk/sync'
import type { DataController } from './controller'
import { describeError } from './core/errors'
import { findKey } from './core/localeFile'

export async function showKeyInFile(path: string, key: string) {
  const document = await vscode.workspace.openTextDocument(path)
  const offset = findKey(document.getText(), key)
  const position =
    offset === undefined ? undefined : document.positionAt(offset)
  await vscode.window.showTextDocument(document, {
    selection: position && new vscode.Range(position, position),
  })
}

/** Opens the display locale's file at `key`, or the source locale's when the key is missing there. */
export async function openKeyInLocaleFile(
  controller: DataController,
  key: string,
) {
  const { config: loaded, data } = controller
  if (!loaded?.config.files || !data) return
  try {
    const locales = [...new Set([data.displayLocale, data.sourceLocale])]
    const files = (await readLocalFiles(loaded, locales)).filter(
      (file) => file.source !== null,
    )
    const file =
      files.find((one) => findKey(one.source!, key) !== undefined) ?? files[0]
    if (!file) {
      void vscode.window.showWarningMessage(
        `Localness: no locale file for ${locales.join(' or ')} yet.`,
      )
      return
    }
    await showKeyInFile(file.path, key)
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Localness: could not open the locale file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Pulls one key into the locale files after the editor changed it, so the
 * files keep up without a full `localness pull`. With `locale` (an edit), that
 * locale takes the project's text even over a local change: the user just
 * chose it. Otherwise (an extraction) local changes are kept.
 */
export async function pullKey(
  controller: DataController,
  key: string,
  locale?: string,
) {
  const { config: loaded, client } = controller
  if (!loaded?.config.files || !client) return
  if (
    locale &&
    loaded.config.locales &&
    !loaded.config.locales.includes(locale)
  ) {
    return
  }
  try {
    const comparison = await compareLocaleFiles(loaded, client, {
      keys: [key],
      locales: locale ? [locale] : undefined,
    })
    const files = await pullLocaleFiles(loaded, comparison, {
      kinds: locale ? FORCED_PULL_KINDS : PULL_KINDS,
    })
    const written = files.filter((file) => file.output !== null)
    if (written.length > 0) {
      vscode.window.setStatusBarMessage(
        `Localness: wrote ${key} to ${written.map((file) => file.relativePath).join(', ')}`,
        4000,
      )
    }
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Localness: could not write ${key} to the locale files: ${describeError(error, client.baseUrl)}`,
    )
  }
}
