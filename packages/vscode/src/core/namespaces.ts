import {
  NAMESPACE_BOUNDARY,
  namespaceOf,
  stripProjectPrefix,
} from '@localness/sdk'

const BOUNDARY = new Set<string>(NAMESPACE_BOUNDARY)

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
 * Declared namespaces come in the platform's display order and, like the
 * platform's, are relative to the project's key prefix. Without any, keys group
 * by their first segment after the prefix; a key with no boundary stays ungrouped.
 */
export function groupByNamespace<T extends { key: string }>(
  items: readonly T[],
  names: readonly string[],
  keyPrefix: string,
): KeyGroup<T>[] {
  const declared = names.length > 0
  const groups = new Map<string | null, T[]>()
  for (const item of items) {
    let name: string | null
    if (declared) {
      name = namespaceOf(item.key, names, keyPrefix)
    } else {
      const path = stripProjectPrefix(item.key, keyPrefix)
      const segment = firstSegment(path)
      name = segment && segment !== path ? segment : null
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
