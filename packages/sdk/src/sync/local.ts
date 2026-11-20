import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  emptyEntries,
  localeFilePath,
  readLocaleFile,
  type LocaleFileContent,
  type LocaleFileFormat,
} from '@localness/contract/locale-file'
import {
  normalizeDir,
  requireFiles,
  type LoadedConfig,
  type LocalnessFilesConfig,
} from './config'

export interface LocalLocaleFile {
  /** Platform locale code. */
  locale: string
  /** Normalized `dir` of the config entry the file belongs to. */
  dir: string
  /** The entry's format, which a write to this file follows. */
  format: LocaleFileFormat
  /** Absolute path. */
  path: string
  /** Relative to the config file, `/`-separated. */
  relativePath: string
  /** Null when the file does not exist yet. */
  source: string | null
  content: LocaleFileContent
}

/** One place a key is written in a locale. */
export interface LocalKeyLocation {
  dir: string
  relativePath: string
  value: string
  /** The property path in the file. */
  path: string[]
}

export interface LocalLocale {
  locale: string
  /**
   * The locale's texts across all directories. A key whose locations hold
   * different texts is left out: no one of them is the local text.
   */
  entries: Record<string, string>
  /** Per key, where this locale has it. */
  locations: Record<string, LocalKeyLocation[]>
}

export interface LocalPlacement {
  /** Per key, the directories holding it in any read locale. */
  dirs: Record<string, string[]>
  /** Per locale, per key: the locale's locations. */
  locations: Record<string, Record<string, LocalKeyLocation[]>>
}

export interface LocalFiles {
  /** Every directory's file of every locale, locales first, then config order. */
  files: LocalLocaleFile[]
  locales: LocalLocale[]
  placement: LocalPlacement
}

async function readFileOf(
  loaded: LoadedConfig,
  entry: LocalnessFilesConfig,
  locale: string,
): Promise<LocalLocaleFile> {
  const relativePath = localeFilePath(
    entry.dir,
    entry.pattern,
    locale,
    loaded.config.localeMap ?? null,
  )
  const path = join(loaded.root, ...relativePath.split('/'))
  const source = await readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  let content: LocaleFileContent
  try {
    content =
      source === null
        ? { entries: emptyEntries(), paths: new Map(), blocked: [] }
        : readLocaleFile(source)
  } catch (error) {
    throw new Error(
      `${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return {
    locale,
    dir: normalizeDir(entry.dir),
    format: entry.format,
    path,
    relativePath,
    source,
    content,
  }
}

export interface ReadLocalFilesOptions {
  /**
   * Locales read only to learn which directories hold a key. Their files are
   * not returned; `placement.dirs` covers them, so a key's place does not
   * depend on which locales were requested.
   */
  placementLocales?: readonly string[]
}

export async function readLocalFiles(
  loaded: LoadedConfig,
  locales: readonly string[],
  options: ReadLocalFilesOptions = {},
): Promise<LocalFiles> {
  const configured = requireFiles(loaded)
  const scanned = [
    ...new Set([...locales, ...(options.placementLocales ?? [])]),
  ]
  const all = await Promise.all(
    scanned.flatMap((locale) =>
      configured.map((entry) => readFileOf(loaded, entry, locale)),
    ),
  )
  const dirs: LocalPlacement['dirs'] = Object.create(null)
  for (const file of all) {
    for (const key of Object.keys(file.content.entries)) {
      const own = (dirs[key] ??= [])
      if (!own.includes(file.dir)) own.push(file.dir)
    }
  }
  const files = all.filter((file) => locales.includes(file.locale))
  const placed: LocalPlacement['locations'] = {}
  const merged = locales.map((locale): LocalLocale => {
    const locations: LocalLocale['locations'] = Object.create(null)
    for (const file of files.filter((item) => item.locale === locale)) {
      for (const [key, value] of Object.entries(file.content.entries)) {
        const list = (locations[key] ??= [])
        list.push({
          dir: file.dir,
          relativePath: file.relativePath,
          value,
          path: file.content.paths.get(key) ?? [key],
        })
      }
    }
    const entries = emptyEntries()
    for (const [key, list] of Object.entries(locations)) {
      if (list.every((item) => item.value === list[0]!.value)) {
        entries[key] = list[0]!.value
      }
    }
    placed[locale] = locations
    return { locale, entries, locations }
  })
  return {
    files,
    locales: merged,
    placement: { dirs, locations: placed },
  }
}

// The server's `/match` rule: layout whitespace is not wording.
const matchText = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Per text, the keys in `entries` holding it, matched the way `/match` matches. */
export function matchLocalEntries(
  entries: Record<string, string>,
  texts: readonly string[],
): string[][] {
  const byText = new Map<string, string[]>()
  for (const [key, text] of Object.entries(entries)) {
    const normalized = matchText(text)
    if (!normalized) continue
    byText.set(normalized, [...(byText.get(normalized) ?? []), key])
  }
  return texts.map((text) => byText.get(matchText(text)) ?? [])
}
