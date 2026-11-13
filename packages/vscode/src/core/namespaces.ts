const BOUNDARY = new Set(['_', '.', '-', ':', '/'])

/** Same rule as the platform: longest name followed by a boundary character wins. */
export function namespaceOf(
  key: string,
  names: readonly string[],
): string | null {
  let best: string | null = null
  for (const name of names) {
    if (
      !name ||
      !key.startsWith(name) ||
      !BOUNDARY.has(key.charAt(name.length))
    )
      continue
    if (!best || name.length > best.length) best = name
  }
  return best
}

export function firstSegment(key: string): string {
  const index = [...key].findIndex((char) => BOUNDARY.has(char))
  return index === -1 ? key : key.slice(0, index)
}

export interface KeyGroup<T> {
  /** Null for keys in no namespace. */
  name: string | null
  items: T[]
}

/**
 * Declared namespaces come in the platform's display order. Without any, keys
 * group by their first segment; a key with no boundary stays ungrouped.
 */
export function groupByNamespace<T extends { key: string }>(
  items: readonly T[],
  names: readonly string[],
): KeyGroup<T>[] {
  const declared = names.length > 0
  const groups = new Map<string | null, T[]>()
  for (const item of items) {
    let name: string | null
    if (declared) {
      name = namespaceOf(item.key, names)
    } else {
      const segment = firstSegment(item.key)
      name = segment && segment !== item.key ? segment : null
    }
    const list = groups.get(name)
    if (list) list.push(item)
    else groups.set(name, [item])
  }
  const order = declared
    ? names.filter((name) => groups.has(name))
    : [...groups.keys()]
        .filter((name): name is string => name !== null)
        .sort((a, b) => a.localeCompare(b))
  const result: KeyGroup<T>[] = [...new Set(order)].map((name) => ({
    name,
    items: sortByKey(groups.get(name) ?? []),
  }))
  const ungrouped = groups.get(null)
  if (ungrouped) result.push({ name: null, items: sortByKey(ungrouped) })
  return result
}

function sortByKey<T extends { key: string }>(items: T[]) {
  return items.sort((a, b) => a.key.localeCompare(b.key))
}
