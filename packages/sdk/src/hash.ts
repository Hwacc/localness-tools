import { createHash } from 'node:crypto'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .filter((name) => record[name] !== undefined)
        .map((name) => [name, canonical(record[name])]),
    )
  }
  return value
}

/** JSON with object keys sorted at every depth, so equal data stringifies equally. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value))
}

/** SHA-256 hex of the stable JSON form. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}
