import {
  DIFF_KINDS,
  compareLocaleFiles,
  type Comparison,
  type DiffEntry,
  type DiffKind,
} from '@localness/sdk/sync'
import {
  EXIT_DIFFERENT,
  list,
  loadProject,
  type CliIo,
  type CliValues,
} from './shared'

const MAX_TEXT = 60

export function quote(text: string | null) {
  if (text === null) return '(none)'
  const short =
    text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text
  return JSON.stringify(short)
}

function detail(entry: DiffEntry) {
  const { local, platform, draft, base } = entry
  switch (entry.kind) {
    case 'platform-added':
      return quote(platform)
    case 'platform-changed':
      return `${quote(local)} → ${quote(platform)}`
    case 'platform-deleted':
      return `${quote(local)} (deleted in the project)`
    case 'local-added':
      return `${quote(local)} (${entry.onPlatform ? 'no text' : 'not'} in the project)`
    case 'local-changed':
      return `${quote(platform)} → ${quote(local)}`
    case 'local-deleted':
      return `${quote(platform)} (deleted locally)`
    case 'different':
      return `local ${quote(local)}, project ${quote(platform)}`
    case 'conflict':
      return [
        `local ${quote(local)}`,
        `project ${quote(platform)}`,
        draft !== null && draft !== platform && `unpublished ${quote(draft)}`,
        `base ${quote(base)}`,
      ]
        .filter(Boolean)
        .join(', ')
    case 'pending-publish':
      return `${quote(local)} (draft waiting for a publish)`
  }
}

const KIND_WIDTH = Math.max(...DIFF_KINDS.map((kind) => kind.length))

export function describeEntry(entry: DiffEntry) {
  return `  ${entry.kind.padEnd(KIND_WIDTH)}  ${entry.key}: ${detail(entry)}`
}

export function countKinds(entries: readonly DiffEntry[]) {
  const counts = new Map<DiffKind, number>()
  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
  }
  return DIFF_KINDS.filter((kind) => counts.has(kind))
    .map((kind) => `${counts.get(kind)} ${kind}`)
    .join(', ')
}

export function filesByLocale(comparison: Comparison) {
  return Object.fromEntries(
    comparison.files.map((file) => [file.locale, file.relativePath]),
  )
}

const HINTS: [readonly DiffKind[], string][] = [
  [
    ['platform-added', 'platform-changed', 'different'],
    '"localness pull" takes the project\'s text for platform-added, platform-changed and different.',
  ],
  [
    ['local-added', 'local-changed'],
    '"localness push" plans sending local-added and local-changed.',
  ],
  [
    ['conflict', 'local-deleted', 'platform-deleted'],
    'Name a key to choose a side: "pull --keys <key>" or "push --keys <key>"; "pull --prune" drops platform-deleted.',
  ],
]

export async function runDiff(io: CliIo, values: CliValues) {
  const { client, loaded } = await loadProject(io, values)
  const comparison = await compareLocaleFiles(loaded, client, {
    locales: list(values.locales),
    keys: list(values.keys),
  })
  const files = filesByLocale(comparison)
  const { entries } = comparison
  if (values.json) {
    io.stdout(
      `${JSON.stringify(
        {
          sourceLocale: comparison.sourceLocale,
          locales: comparison.locales,
          content: comparison.content,
          hasBase: comparison.base !== null,
          files,
          differences: entries,
        },
        null,
        2,
      )}\n`,
    )
  } else if (entries.length === 0) {
    io.stdout(
      `Up to date: ${comparison.locales.length} locale files match the project's ${comparison.content} text.\n`,
    )
  } else {
    for (const locale of comparison.locales) {
      const own = entries.filter((entry) => entry.locale === locale)
      if (own.length === 0) continue
      io.stdout(`${files[locale]} (${locale})\n`)
      for (const entry of own) io.stdout(`${describeEntry(entry)}\n`)
    }
    io.stdout(
      `\n${entries.length} differences against the project's ${comparison.content} text: ${countKinds(entries)}.\n`,
    )
    if (comparison.base === null) {
      io.stdout(
        'No base yet, so changed text shows as "different"; pull or sync records one.\n',
      )
    }
    for (const [kinds, hint] of HINTS) {
      if (entries.some((entry) => kinds.includes(entry.kind))) {
        io.stdout(`${hint}\n`)
      }
    }
  }
  return entries.length > 0 ? EXIT_DIFFERENT : 0
}
