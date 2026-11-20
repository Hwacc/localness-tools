import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve } from 'node:path'
import {
  DEFAULT_LOCALE_FILE_PATTERN,
  LOCALE_PLACEHOLDER,
  LocaleFileFormat,
  localeFileName,
  localeFilesScopeError,
  readLocaleFile,
} from '@localness/contract/locale-file'
import { createClient, findRelease, namespaceOf } from '@localness/sdk'
import {
  CONFIG_FILE_NAME,
  parseConfig,
  type LocalnessConfigInput,
} from '@localness/sdk/sync'
import { ENV_FILE, TOKEN_ENV, findEnvToken } from './env'
import type { CliIo, CliValues } from './shared'

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
])
const MAX_DEPTH = 6
const LOCALE_NAME = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,8})*$/i
const languageNames = new Intl.DisplayNames(['en'], {
  type: 'language',
  fallback: 'none',
})

/** `en`, `zh-CN`, `pt_br`: a known language, optionally with subtags. */
export function isLocaleName(name: string) {
  const language = LOCALE_NAME.exec(name)?.[1]
  return (
    language !== undefined &&
    languageNames.of(language.toLowerCase()) !== undefined
  )
}

export interface LocaleFileGroup {
  dir: string
  pattern: string
  /** File locale name → `/`-separated path relative to the root. */
  files: Map<string, string>
}

/** Relative `/`-separated paths of the JSON files under `root`. */
async function scan(root: string, dir = root, depth = 0): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (
        depth < MAX_DEPTH &&
        !entry.name.startsWith('.') &&
        !SKIP_DIRS.has(entry.name)
      ) {
        found.push(...(await scan(root, path, depth + 1)))
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      found.push(relative(root, path).split('\\').join('/'))
    }
  }
  return found
}

/**
 * Candidate layouts — `dir/{locale}.json` or `dir/{locale}/name.json` — with
 * the most locales first.
 */
export function groupLocaleFiles(paths: readonly string[]): LocaleFileGroup[] {
  const groups = new Map<string, LocaleFileGroup>()
  const add = (dir: string, pattern: string, name: string, path: string) => {
    if (localeFilesScopeError(dir, pattern) !== null) return
    const id = `${dir}\n${pattern}`
    const group = groups.get(id) ?? { dir, pattern, files: new Map() }
    group.files.set(name, path)
    groups.set(id, group)
  }
  for (const path of paths) {
    const segments = path.split('/')
    const file = segments.at(-1)!
    const name = file.slice(0, -'.json'.length)
    if (isLocaleName(name)) {
      add(
        segments.slice(0, -1).join('/'),
        DEFAULT_LOCALE_FILE_PATTERN,
        name,
        path,
      )
    }
    const parent = segments.at(-2)
    if (segments.length >= 3 && parent && isLocaleName(parent)) {
      add(
        segments.slice(0, -2).join('/'),
        `${LOCALE_PLACEHOLDER}/${file}`,
        parent,
        path,
      )
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.files.size - a.files.size || a.dir.length - b.dir.length,
  )
}

const FALLBACK_NAMES = ['default', 'common', 'base', 'main', 'shared', 'core']
const OWN_SHARE = 0.8
const OTHER_SHARE = 0.2

/**
 * The directory `groups` start from, plus its siblings: same pattern, same
 * parent, and a locale in common (`locales/default/`, `locales/boostprime/`).
 * The directory new keys fall back to comes first.
 */
export function pickGroups(groups: readonly LocaleFileGroup[]) {
  const [top] = groups
  if (!top) return []
  const parent = posix.dirname(top.dir)
  const siblings = groups.filter(
    (group) =>
      group !== top &&
      group.pattern === top.pattern &&
      posix.dirname(group.dir) === parent &&
      [...group.files.keys()].some((name) => top.files.has(name)),
  )
  const all = [top, ...siblings]
  const fallback =
    all.find((group) => FALLBACK_NAMES.includes(posix.basename(group.dir))) ??
    top
  return [fallback, ...all.filter((group) => group !== fallback)]
}

async function keysOf(root: string, group: LocaleFileGroup) {
  const keys = new Set<string>()
  for (const path of group.files.values()) {
    try {
      const source = await readFile(join(root, path), 'utf8')
      for (const key of Object.keys(readLocaleFile(source).entries)) {
        keys.add(key)
      }
    } catch {
      continue
    }
  }
  return [...keys]
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A `match` that sends `own`'s kind of key here: the platform namespace
 * most of its keys belong to, else the leading word most share. It must be
 * rare among `rest`, the other directories' keys.
 */
export function inferMatch(
  own: readonly string[],
  rest: readonly string[],
  namespaces: readonly string[],
  keyPrefix: string,
): { namespace: string } | { key: string } | undefined {
  if (own.length === 0) return undefined
  const labelers: [
    (key: string) => string | null,
    (label: string) => { namespace: string } | { key: string },
  ][] = []
  if (namespaces.length > 0) {
    labelers.push([
      (key) => namespaceOf(key, namespaces, keyPrefix),
      (namespace) => ({ namespace }),
    ])
  }
  if (keyPrefix === '') {
    labelers.push([
      (key) => /^([^_.-]+)[_.-]/.exec(key)?.[1] ?? null,
      (word) => ({ key: `^${escapeRegExp(word)}[_.-]` }),
    ])
  }
  for (const [labelOf, toMatch] of labelers) {
    const counts = new Map<string, number>()
    for (const key of own) {
      const label = labelOf(key)
      if (label !== null) counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    const [label, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? []
    if (label === undefined || count! / own.length < OWN_SHARE) continue
    const elsewhere = rest.filter((key) => labelOf(key) === label).length
    if (elsewhere <= rest.length * OTHER_SHARE) return toMatch(label)
  }
  return undefined
}

/** Nested when any file nests; flat when keys contain dots but never nest. */
async function detectFormat(
  root: string,
  paths: Iterable<string>,
): Promise<LocaleFileFormat> {
  let dotted = false
  for (const path of paths) {
    let segmentsList: string[][]
    try {
      const source = await readFile(join(root, path), 'utf8')
      segmentsList = [...readLocaleFile(source).paths.values()]
    } catch {
      continue
    }
    for (const segments of segmentsList) {
      if (segments.length > 1) return LocaleFileFormat.NESTED_JSON
      if (segments[0]!.includes('.')) dotted = true
    }
  }
  return dotted ? LocaleFileFormat.FLAT_JSON : LocaleFileFormat.NESTED_JSON
}

const loose = (name: string) => name.toLowerCase().replace(/_/g, '-')

/**
 * Pairs project locales with file names: exactly as `localeFileName` names
 * them, else ignoring case and `_`/`-`, which then needs a `localeMap` entry.
 */
export function matchLocales(
  locales: readonly string[],
  names: readonly string[],
) {
  const localeMap: Record<string, string> = {}
  const matched = new Set<string>()
  const withoutFile: string[] = []
  for (const locale of locales) {
    const expected = localeFileName(locale, null)
    const name =
      names.find((candidate) => candidate === expected) ??
      names.find(
        (candidate) =>
          loose(candidate) === loose(expected) ||
          loose(candidate) === loose(locale),
      )
    if (!name) {
      withoutFile.push(locale)
      continue
    }
    matched.add(name)
    if (name !== expected) localeMap[locale] = name
  }
  return {
    localeMap,
    withoutFile,
    unmatched: names.filter((name) => !matched.has(name)),
  }
}

function parseFormat(value: string): LocaleFileFormat {
  const formats = Object.values(LocaleFileFormat) as string[]
  if (!formats.includes(value)) {
    throw new Error(`--format must be ${formats.join(' or ')}.`)
  }
  return value as LocaleFileFormat
}

export async function runInit(io: CliIo, values: CliValues) {
  const target = resolve(io.cwd, values.config ?? CONFIG_FILE_NAME)
  const root = dirname(target)
  const shown = relative(io.cwd, target) || CONFIG_FILE_NAME
  const exists = await stat(target).then(
    () => true,
    () => false,
  )
  if (exists && !values.force) {
    throw new Error(`${shown} already exists; pass --force to replace it.`)
  }
  const baseUrl = values['base-url']?.trim()
  if (!baseUrl)
    throw new Error('Pass --base-url <url> of the Localness instance.')

  const notes: string[] = []
  const groups = groupLocaleFiles(await scan(root))
  let used: LocaleFileGroup[]
  if (values.dir !== undefined) {
    const dir = values.dir.replace(/\\/g, '/').replace(/\/+$/, '')
    const pattern = values.pattern ?? DEFAULT_LOCALE_FILE_PATTERN
    const group = groups.find(
      (candidate) => candidate.dir === dir && candidate.pattern === pattern,
    ) ?? { dir, pattern, files: new Map() }
    if (group.files.size === 0)
      notes.push(`No files match ${dir}/${pattern} yet.`)
    used = [group]
  } else {
    if (groups.length === 0) {
      throw new Error(
        'Found no locale JSON files like src/locales/en.json; pass --dir and --pattern.',
      )
    }
    used = pickGroups(groups)
    if (used.length > 1) {
      notes.push(
        `Found ${used.length} sibling directories (${used.map((group) => group.dir).join(', ')}); all are synced, new keys go where "match" says, else to ${used[0]!.dir}.`,
      )
    }
    const others = groups.filter((group) => !used.includes(group)).slice(0, 3)
    if (others.length > 0) {
      notes.push(
        `Also found ${others.map((other) => `${other.dir}/${other.pattern}`).join(', ')}; pass --dir and --pattern to use another.`,
      )
    }
  }
  const formats = await Promise.all(
    used.map((group) =>
      values.format
        ? parseFormat(values.format)
        : detectFormat(root, group.files.values()),
    ),
  )
  const names = [
    ...new Set(used.flatMap((group) => [...group.files.keys()])),
  ].sort()

  const config: LocalnessConfigInput = { baseUrl }
  if (values.project) config.project = values.project
  const entries = used.map((group, index) => ({
    dir: group.dir,
    pattern: group.pattern,
    format: formats[index]!,
  }))
  config.files = entries.length === 1 ? entries[0]! : entries
  let namespaces: string[] = []
  let keyPrefix = ''
  const token = await findEnvToken(root, io.env)
  if (token) {
    const client = createClient({
      baseUrl,
      token,
      project: values.project,
      fetch: io.fetch,
    })
    const meta = await client.meta()
    config.project ??= meta.project.name
    namespaces = (meta.namespaces ?? []).map((namespace) => namespace.name)
    keyPrefix = meta.keyConvention?.prefix ?? ''
    if (values.release) {
      const release = findRelease(meta.releases, values.release)
      if (!release) {
        throw new Error(
          `The project has no release "${values.release}"; it has ${meta.releases.map((item) => item.name).join(', ') || 'none'}.`,
        )
      }
      config.release = release.name
    } else if (meta.releases.length > 0) {
      notes.push(
        `New keys get no release; "localness releases use" picks one (${meta.releases.map((item) => item.name).join(', ')}).`,
      )
    }
    const { localeMap, withoutFile, unmatched } = matchLocales(
      meta.locales,
      names,
    )
    if (Object.keys(localeMap).length > 0) config.localeMap = localeMap
    if (unmatched.length > 0) {
      notes.push(
        `No project locale for ${unmatched.join(', ')} (project: ${meta.locales.join(', ')}); map them in "localeMap", e.g. { "zh_cn": "zh" }.`,
      )
    }
    if (withoutFile.length > 0 && names.length > 0) {
      notes.push(
        `No file yet for ${withoutFile.join(', ')}; "localness pull" creates them, or list the locales to sync in "locales".`,
      )
    }
  } else {
    if (values.release) config.release = values.release
    notes.push(
      `${TOKEN_ENV} is not set in ${ENV_FILE} or the environment, so file names were not checked against the project's locales.`,
    )
  }
  if (entries.length > 1) {
    const keys = await Promise.all(used.map((group) => keysOf(root, group)))
    for (const [index, entry] of entries.entries()) {
      if (index === 0) continue
      const match = inferMatch(
        keys[index]!,
        keys.filter((_, other) => other !== index).flat(),
        namespaces,
        keyPrefix,
      )
      if (match) Object.assign(entry, { match })
      else {
        notes.push(
          `No match inferred for ${entry.dir}; add a "match" (key or namespace) so new keys can be routed there.`,
        )
      }
    }
  }
  parseConfig(JSON.stringify(config), shown)

  const text = `${JSON.stringify(config, null, 2)}\n`
  const dryRun = values['dry-run'] ?? false
  if (!dryRun) await writeFile(target, text, 'utf8')
  if (values.json) {
    io.stdout(
      `${JSON.stringify({ path: shown, dryRun, config, files: names, notes }, null, 2)}\n`,
    )
    return 0
  }
  io.stdout(`${dryRun ? 'Would write' : 'Wrote'} ${shown}:\n${text}`)
  if (names.length > 0) io.stdout(`Locale files: ${names.join(', ')}\n`)
  for (const note of notes) io.stdout(`- ${note}\n`)
  return 0
}
