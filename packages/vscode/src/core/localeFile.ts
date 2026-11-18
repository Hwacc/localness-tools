function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Where `key` is written in a flat or nested JSON file, best effort. */
export function findKey(source: string, key: string) {
  const property = (name: string, from: number) => {
    const match = new RegExp(`${escapeRegExp(JSON.stringify(name))}\\s*:`, 'g')
    match.lastIndex = from
    return match.exec(source)?.index
  }
  const flat = property(key, 0)
  if (flat !== undefined) return flat
  let offset: number | undefined
  for (const segment of key.split('.')) {
    offset = property(segment, offset === undefined ? 0 : offset + 1)
    if (offset === undefined) return undefined
  }
  return offset
}
