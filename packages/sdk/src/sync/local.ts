import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  LOCALE_PLACEHOLDER,
  emptyEntries,
  localeFileName,
  localeFilePath,
  readLocaleFile,
  type LocaleFileContent,
  type LocaleFileFormat,
  type LocaleKeyPath,
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
  /** The property path in the file; a number is an array index. */
  path: LocaleKeyPath
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
  /**
   * Keys a file of this locale writes with an empty value: present in
   * `paths`, absent from that file's `entries`. Sorted.
   */
  empties: string[]
}

export interface LocalPlacement {
  /** Per key, the directories holding it in any read locale. */
  dirs: Record<string, string[]>
  /** Per locale, per key: the locale's locations. */
  locations: Record<string, Record<string, LocalKeyLocation[]>>
  /** Per locale, keys a file writes with an empty value. Sorted. */
  empties: Record<string, string[]>
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
        ? { entries: emptyEntries(), paths: new Map(), blocked: [], arrays: [] }
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
  const empties: LocalPlacement['empties'] = {}
  const merged = locales.map((locale): LocalLocale => {
    const locations: LocalLocale['locations'] = Object.create(null)
    const empty = new Set<string>()
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
      for (const key of file.content.paths.keys()) {
        if (!Object.hasOwn(file.content.entries, key)) empty.add(key)
      }
    }
    const entries = emptyEntries()
    for (const [key, list] of Object.entries(locations)) {
      if (list.every((item) => item.value === list[0]!.value)) {
        entries[key] = list[0]!.value
      }
    }
    const blank = [...empty].sort()
    placed[locale] = locations
    empties[locale] = blank
    return { locale, entries, locations, empties: blank }
  })
  return {
    files,
    locales: merged,
    placement: { dirs, locations: placed, empties },
  }
}

/**
 * `/`-separated paths of the files exactly `depth` directories below `dir`,
 * relative to it. Missing: none.
 */
async function filesIn(dir: string, depth: number): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: string[] = []
  for (const entry of entries) {
    if (depth > 0 && entry.isDirectory()) {
      for (const name of await filesIn(join(dir, entry.name), depth - 1)) {
        found.push(`${entry.name}/${name}`)
      }
    } else if (depth === 0 && entry.isFile()) found.push(entry.name)
  }
  return found
}

/** `{locale}` is one path segment; the rest of the pattern is literal. */
function localeNamePattern(pattern: string) {
  const [before, after] = pattern.split(LOCALE_PLACEHOLDER)
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escape(before ?? '')}([^/]+)${escape(after ?? '')}$`)
}

// `zh` and `zh_cn` share a language; case and `-`/`_` do not count.
function languageOf(name: string) {
  return name.toLowerCase().split(/[-_]/)[0] ?? ''
}

function similarLocales(name: string, locales: readonly string[]) {
  const language = languageOf(name)
  if (!language) return []
  return locales.filter((locale) => languageOf(locale) === language)
}

function strayFileWarning(
  relativePath: string,
  name: string,
  projectLocales: readonly string[],
  parseError: string | undefined,
) {
  const project = projectLocales.join(', ') || 'none'
  const like = similarLocales(name, projectLocales)
  const hint =
    like.length > 0
      ? `; "${name}" looks like ${like.join(', ')}, so check localeMap`
      : ''
  const parsed = parseError ? ` It cannot be parsed: ${parseError}.` : ''
  return `${relativePath} is not a project locale${hint} (the project has: ${project}).${parsed}`
}

/**
 * One warning per file under a configured directory that matches its pattern
 * and is not a project locale. A missing directory adds nothing.
 */
export async function strayLocaleFileWarnings(
  loaded: LoadedConfig,
  projectLocales: readonly string[],
): Promise<string[]> {
  const localeMap = loaded.config.localeMap ?? null
  const warnings: string[] = []
  for (const entry of requireFiles(loaded)) {
    const pattern = localeNamePattern(entry.pattern)
    const names = (
      await filesIn(
        join(loaded.root, ...entry.dir.split('/')),
        entry.pattern.split('/').length - 1,
      )
    ).sort()
    for (const name of names) {
      const localeName = pattern.exec(name)?.[1]
      if (localeName === undefined) continue
      const known = projectLocales.some(
        (locale) => localeFileName(locale, localeMap) === localeName,
      )
      if (known) continue
      const relativePath = `${entry.dir}/${name}`
      let parseError: string | undefined
      try {
        readLocaleFile(
          await readFile(join(loaded.root, ...relativePath.split('/')), 'utf8'),
        )
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error)
      }
      warnings.push(
        strayFileWarning(relativePath, localeName, projectLocales, parseError),
      )
    }
  }
  return warnings
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
