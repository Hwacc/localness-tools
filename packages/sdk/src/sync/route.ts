import { namespaceOf } from '@localness/contract/rules'
import { normalizeDir, type LocalnessFilesConfig } from './config'

/** How a key's directory was decided. */
export type RouteBy = 'existing' | 'namespace' | 'key' | 'fallback' | 'unrouted'

export interface RouteTarget {
  /** Normalized `dir` of a configured entry; null when `by` is `unrouted`. */
  dir: string | null
  by: RouteBy
}

export interface RouteContext {
  /** The project's declared namespace names. */
  namespaces: readonly string[]
  /** The project's key prefix, without its trailing separator. */
  keyPrefix: string
  /** Directories already holding the key, in any locale. */
  existing?: readonly string[]
}

/**
 * Where a key lives or, when new, goes: the directory that already has it,
 * else the first entry whose `match` fits, else the first entry without one.
 */
export function routeKey(
  key: string,
  files: readonly LocalnessFilesConfig[],
  context: RouteContext,
): RouteTarget {
  const [existing] = context.existing ?? []
  if (existing !== undefined) return { dir: existing, by: 'existing' }
  let namespace: string | null | undefined
  for (const file of files) {
    const { match } = file
    if (!match) continue
    if (match.key !== undefined && !new RegExp(match.key).test(key)) continue
    if (match.namespace !== undefined) {
      namespace ??= namespaceOf(key, context.namespaces, context.keyPrefix)
      if (namespace !== match.namespace) continue
    }
    return {
      dir: normalizeDir(file.dir),
      by: match.namespace !== undefined ? 'namespace' : 'key',
    }
  }
  const fallback = files.find((file) => !file.match)
  return fallback
    ? { dir: normalizeDir(fallback.dir), by: 'fallback' }
    : { dir: null, by: 'unrouted' }
}

/** Namespaces a `match` names that the project does not declare. */
export function unknownNamespaces(
  files: readonly LocalnessFilesConfig[],
  declared: readonly string[],
) {
  const known = new Set(declared)
  return [
    ...new Set(
      files.flatMap((file) => {
        const name = file.match?.namespace
        return name !== undefined && !known.has(name) ? [name] : []
      }),
    ),
  ]
}
