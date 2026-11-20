import {
  planPull,
  type Comparison,
  type DiffEntry,
  type DiffKind,
} from '@localness/sdk/sync'

export interface Placement {
  /** Keys with no place the CLI could pick: unrouted, or a duplicate given a new locale. */
  waiting: DiffEntry[]
  /** New keys a rule already routed; a person may still send them elsewhere. */
  fresh: DiffEntry[]
}

export function keysToPlace(
  comparison: Comparison,
  kinds: readonly DiffKind[],
  confirmNew: boolean,
): Placement {
  const dirs = new Set(comparison.files.map((file) => file.dir))
  if (dirs.size < 2) return { waiting: [], fresh: [] }
  const plan = planPull(comparison, { kinds })
  const waiting = [
    ...plan.unrouted,
    ...plan.duplicates.filter(
      (entry) => kinds.includes(entry.kind) && entry.platform !== null,
    ),
  ]
  const fresh = confirmNew
    ? comparison.entries.filter(
        (entry) =>
          kinds.includes(entry.kind) &&
          entry.platform !== null &&
          entry.dirs.length === 0 &&
          entry.target.dir !== null,
      )
    : []
  return { waiting, fresh }
}

/** `comparison` with the chosen directory applied to `placement`'s keys, and the `into` for `planPull`. */
export function placeIn(
  comparison: Comparison,
  placement: Placement,
  dir: string,
) {
  const moved = new Set(placement.fresh)
  return {
    comparison: {
      ...comparison,
      entries: comparison.entries.map((entry) =>
        moved.has(entry)
          ? { ...entry, target: { dir, by: entry.target.by } }
          : entry,
      ),
    },
    into: placement.waiting.length > 0 ? dir : undefined,
  }
}

/** One mark per file holding a key whose texts differ between directories. */
export function duplicateMarks(entries: readonly DiffEntry[]) {
  return entries.flatMap((entry) => {
    if (entry.kind !== 'duplicate' || entry.locations.length < 2) return []
    return entry.locations.map((place) => ({
      relativePath: place.relativePath,
      key: entry.key,
      message: `${entry.key} has different texts in ${entry.locations
        .map((other) => other.dir)
        .join(', ')}; pull or delete the extra copies to settle it`,
    }))
  })
}
