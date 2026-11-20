import { loadProject, type CliIo, type CliValues } from './shared'

/** Asks the project's AI naming; writes nothing. */
export async function runSuggestName(
  io: CliIo,
  values: CliValues,
  text: string,
) {
  if (!text.trim()) {
    throw new Error('Usage: localness suggest-name "<source text>"')
  }
  const { client } = await loadProject(io, values)
  const suggestion = await client.suggestKeyName(text)
  if (values.json) {
    io.stdout(`${JSON.stringify(suggestion, null, 2)}\n`)
    return 0
  }
  if (!suggestion.key) {
    io.stdout('No name: the text has nothing to name.\n')
    return 0
  }
  const confidence =
    suggestion.confidence === undefined
      ? ''
      : ` (confidence ${suggestion.confidence})`
  io.stdout(`${suggestion.key}${confidence}\n`)
  if (suggestion.alternatives?.length) {
    io.stdout(
      `Alternatives: ${suggestion.alternatives.map((item) => item.key).join(', ')}\n`,
    )
  }
  if (suggestion.violations.length > 0) {
    io.stdout(
      `Breaks the project's key convention: ${suggestion.violations.join(', ')}\n`,
    )
  }
  for (const duplicate of suggestion.duplicates) {
    io.stdout(
      `Already on remote: ${duplicate.key} ${JSON.stringify(duplicate.sourceText)}${duplicate.sameSourceText ? ', same text; reuse it' : ''}\n`,
    )
  }
  if (suggestion.reason) io.stdout(`${suggestion.reason}\n`)
  return 0
}
