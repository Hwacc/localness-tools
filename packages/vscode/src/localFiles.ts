import * as vscode from 'vscode'
import {
  FORCED_PULL_KINDS,
  PULL_KINDS,
  compareLocaleFiles,
  normalizeDir,
  pullLocaleFiles,
  readLocalFiles,
  type Comparison,
  type DiffKind,
  type LoadedConfig,
} from '@localness/sdk/sync'
import type { DataController } from './controller'
import { describeError } from './core/errors'
import { findKey } from './core/localeFile'
import { keysToPlace, placeIn } from './core/placement'

export async function showKeyInFile(path: string, key: string) {
  const document = await vscode.workspace.openTextDocument(path)
  const offset = findKey(document.getText(), key)
  const position =
    offset === undefined ? undefined : document.positionAt(offset)
  await vscode.window.showTextDocument(document, {
    selection: position && new vscode.Range(position, position),
  })
}

/** Opens the display locale's file at `key`, or the source locale's when the key is missing there; asks when several files have it. */
export async function openKeyInLocaleFile(
  controller: DataController,
  key: string,
) {
  const { config: loaded, data } = controller
  if (!loaded?.config.files || !data) return
  try {
    const locales = [...new Set([data.displayLocale, data.sourceLocale])]
    const files = (await readLocalFiles(loaded, locales)).files.filter(
      (file) => file.source !== null,
    )
    for (const locale of locales) {
      const holding = files.filter(
        (file) => file.locale === locale && key in file.content.entries,
      )
      if (holding.length === 0) continue
      const file =
        holding.length === 1
          ? holding[0]
          : (
              await vscode.window.showQuickPick(
                holding.map((one) => ({
                  label: one.relativePath,
                  description: one.locale,
                  file: one,
                })),
                { placeHolder: `${key} is in several files` },
              )
            )?.file
      if (file) await showKeyInFile(file.path, key)
      return
    }
    const [file] = files
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
 * Asks which directory keys without a place go to, when the config has
 * several and a rule did not decide (or, with `confirmNew`, to let a person
 * overrule the rule). Undefined when the person cancels.
 */
export async function placeKeys(
  loaded: LoadedConfig,
  comparison: Comparison,
  kinds: readonly DiffKind[],
  confirmNew: boolean,
): Promise<{ comparison: Comparison; into?: string } | undefined> {
  const placement = keysToPlace(comparison, kinds, confirmNew)
  const asked = [...placement.fresh, ...placement.waiting]
  if (asked.length === 0) return { comparison }
  const dirs = [...new Set(comparison.files.map((file) => file.dir))]
  const fallback = loaded.config.files?.find((file) => !file.match)
  const suggested =
    placement.waiting.length > 0
      ? null
      : (placement.fresh[0]?.target.dir ?? null)
  const first =
    suggested ?? (fallback ? normalizeDir(fallback.dir) : (dirs[0] ?? ''))
  const keys = [...new Set(asked.map((entry) => entry.key))]
  const picked = await vscode.window.showQuickPick(
    [first, ...dirs.filter((dir) => dir !== first)].map((dir) => ({
      label: dir,
      description: dir === first ? 'suggested' : undefined,
    })),
    {
      placeHolder: `Which directory gets ${keys.length === 1 ? keys[0] : `${keys.length} keys`}?`,
    },
  )
  return picked ? placeIn(comparison, placement, picked.label) : undefined
}

/**
 * Pulls one key into the locale files after the editor changed it, so the
 * files keep up without a full `localness pull`. With `locale` (an edit), that
 * locale takes the project's text even over a local change: the user just
 * chose it. Otherwise (an extraction) local changes are kept, and a new key
 * goes to the directory its rule picks unless the person chooses another.
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
    const compared = await compareLocaleFiles(loaded, client, {
      keys: [key],
      locales: locale ? [locale] : undefined,
    })
    const kinds = locale ? FORCED_PULL_KINDS : PULL_KINDS
    const placed = await placeKeys(loaded, compared, kinds, !locale)
    if (!placed) return
    const plan = await pullLocaleFiles(loaded, placed.comparison, {
      kinds,
      into: placed.into,
    })
    const written = plan.files.filter((file) => file.output !== null)
    if (written.length > 0) {
      vscode.window.setStatusBarMessage(
        `Localness: wrote ${key} to ${written.map((file) => file.relativePath).join(', ')}`,
        4000,
      )
    } else if (plan.duplicates.length > 0) {
      void vscode.window.showWarningMessage(
        `Localness: ${key} is in several directories; settle it in the Local Files view.`,
      )
    }
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Localness: could not write ${key} to the locale files: ${describeError(error, client.baseUrl)}`,
    )
  }
}
