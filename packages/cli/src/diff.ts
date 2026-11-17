import { compareLocaleFiles, type DiffEntry } from '@localness/sdk/sync'
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

function describeEntry(entry: DiffEntry) {
  switch (entry.kind) {
    case 'missing-locally':
      return `  + ${entry.key}: ${quote(entry.platform)}`
    case 'different':
      return `  ~ ${entry.key}: ${quote(entry.local)} → ${quote(entry.platform)}`
    case 'missing-on-platform':
      return `  - ${entry.key}: ${quote(entry.local)} (not in the project)`
    case 'empty-on-platform':
      return `  ? ${entry.key}: ${quote(entry.local)} (no text in the project)`
  }
}

export async function runDiff(io: CliIo, values: CliValues) {
  const { client, loaded } = await loadProject(io, values)
  const comparison = await compareLocaleFiles(loaded, client, {
    locales: list(values.locales),
    keys: list(values.keys),
  })
  const files = Object.fromEntries(
    comparison.files.map((file) => [file.locale, file.relativePath]),
  )
  if (values.json) {
    io.stdout(
      `${JSON.stringify(
        {
          sourceLocale: comparison.sourceLocale,
          locales: comparison.locales,
          content: loaded.config.content,
          files,
          differences: comparison.entries,
        },
        null,
        2,
      )}\n`,
    )
  } else if (comparison.entries.length === 0) {
    io.stdout(
      `Up to date: ${comparison.locales.length} locale files match the project's ${loaded.config.content} text.\n`,
    )
  } else {
    for (const locale of comparison.locales) {
      const entries = comparison.entries.filter(
        (entry) => entry.locale === locale,
      )
      if (entries.length === 0) continue
      io.stdout(`${files[locale]} (${locale})\n`)
      for (const entry of entries) io.stdout(`${describeEntry(entry)}\n`)
    }
    io.stdout(
      `\n${comparison.entries.length} differences against the project's ${loaded.config.content} text. "localness pull" writes + and ~.\n`,
    )
  }
  return comparison.entries.length > 0 ? EXIT_DIFFERENT : 0
}
