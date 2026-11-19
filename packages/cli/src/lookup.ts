import type { CaptureMatch } from '@localness/sdk'
import { matchLocalEntries, readLocalFiles } from '@localness/sdk/sync'
import { loadProject, type CliIo, type CliValues } from './shared'

// The server's per-request cap on texts.
const BATCH = 500

type PlatformHit = CaptureMatch['matches'][number]['keys'][number]
export type MatchHit =
  | (PlatformHit & { source: 'platform' })
  | { key: string; sourceText: string; source: 'local' }

/**
 * Which existing keys hold each text. Keys only in the source-locale file (not
 * pushed yet) count too, so extraction does not mint a second key for the
 * same text.
 */
export async function lookupTexts(
  io: CliIo,
  values: CliValues,
  wanted: string[],
) {
  const { client, loaded } = await loadProject(io, values)
  const platform: CaptureMatch['matches'] = []
  for (let start = 0; start < wanted.length; start += BATCH) {
    const page = await client.match(wanted.slice(start, start + BATCH))
    platform.push(...page.matches)
  }
  const meta = await client.meta()
  const [local] =
    loaded.config.files && meta.sourceLocale
      ? await readLocalFiles(loaded, [meta.sourceLocale])
      : []
  const entries = local?.content.entries ?? {}
  const localKeys = matchLocalEntries(
    entries,
    platform.map((match) => match.text),
  )
  const matches = platform.map(({ text, keys }, index) => {
    const known = new Set(keys.map((hit) => hit.key))
    const hits: MatchHit[] = keys.map((hit) => ({ ...hit, source: 'platform' }))
    for (const key of localKeys[index]!) {
      if (!known.has(key)) {
        hits.push({ key, sourceText: entries[key]!, source: 'local' })
      }
    }
    return { text, keys: hits }
  })
  return { client, loaded, meta, entries, matches }
}

/**
 * Prints {@link lookupTexts}; writes nothing. JSON output adds what naming a
 * new key needs: the project's key convention and namespaces.
 */
export async function runMatch(io: CliIo, values: CliValues, texts: string[]) {
  const wanted = texts.filter((text) => text.trim())
  if (wanted.length === 0) {
    throw new Error('Usage: localness match "<text>" ["<text>" ...]')
  }
  const { meta, matches } = await lookupTexts(io, values, wanted)
  if (values.json) {
    const result = {
      matches,
      convention: meta.keyConvention ?? null,
      namespaces: (meta.namespaces ?? []).map((namespace) => namespace.name),
    }
    io.stdout(`${JSON.stringify(result, null, 2)}\n`)
    return 0
  }
  for (const { text, keys } of matches) {
    const hits = keys.map(
      (hit) =>
        `${hit.key}${hit.source === 'local' ? ' (local)' : hit.draft ? ' (draft)' : ''}`,
    )
    const found =
      hits.length === 0
        ? 'no key'
        : hits.length === 1
          ? hits[0]
          : `${hits.length} keys, pick one: ${hits.join(', ')}`
    io.stdout(`${JSON.stringify(text)} -> ${found}\n`)
  }
  return 0
}
