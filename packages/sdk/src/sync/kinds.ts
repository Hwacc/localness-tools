/**
 * Where a key's text stands in one locale. Local (L), project (P) and base (B),
 * the text both sides last agreed on:
 * - `platform-added`: P only, no B. Pull.
 * - `platform-changed`: L is B, P moved. Pull.
 * - `platform-deleted`: the project dropped a key that had B. `pull --prune`.
 * - `local-added`: L only: a key or translation the project lacks. Push.
 * - `local-changed`: P is B, L moved. Push.
 * - `local-deleted`: the file dropped a key P still has as B. Reported only.
 * - `different`: L and P differ with no B to tell who changed. Pull by default.
 * - `conflict`: both moved, or P has someone's unpublished draft. Never automatic.
 * - `pending-publish`: L is the project's unpublished draft; nothing to do.
 * - `empty`: the file writes the key with an empty value and the project has no text; the page likely shows blank. Never automatic.
 */
export const DIFF_KINDS = [
  'platform-added',
  'platform-changed',
  'platform-deleted',
  'local-added',
  'local-changed',
  'local-deleted',
  'different',
  'conflict',
  'pending-publish',
  'empty',
  'duplicate',
] as const

export type DiffKind = (typeof DIFF_KINDS)[number]
