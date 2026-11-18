import type { DeliveryKeyState } from '@localness/sdk'

/** A release id, keys without any release, or undefined for every key. */
export type ReleaseFilter = number | 'unassigned' | undefined

export function filterByRelease(
  keys: readonly DeliveryKeyState[],
  filter: ReleaseFilter,
): readonly DeliveryKeyState[] {
  if (filter === undefined) return keys
  return keys.filter((state) =>
    filter === 'unassigned'
      ? state.releaseIds.length === 0
      : state.releaseIds.includes(filter),
  )
}

export interface ReleaseChange {
  releaseId: number
  mode: 'add' | 'remove'
  keyIds: number[]
}

/**
 * Membership calls that make `keys` match the picks: a picked release is added
 * to every key lacking it; an unpicked one is removed only when every key had
 * it, so a release on some of the keys stays as it was.
 */
export function releaseChanges(
  keys: readonly DeliveryKeyState[],
  releaseIds: readonly number[],
  picked: ReadonlySet<number>,
): ReleaseChange[] {
  const changes: ReleaseChange[] = []
  for (const releaseId of releaseIds) {
    const having = keys.filter((state) => state.releaseIds.includes(releaseId))
    if (picked.has(releaseId)) {
      const lacking = keys.filter((state) => !having.includes(state))
      if (lacking.length > 0) {
        changes.push({
          releaseId,
          mode: 'add',
          keyIds: lacking.map((state) => state.id),
        })
      }
    } else if (having.length > 0 && having.length === keys.length) {
      changes.push({
        releaseId,
        mode: 'remove',
        keyIds: having.map((state) => state.id),
      })
    }
  }
  return changes
}
