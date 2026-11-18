import { findRelease, type LocalnessClient } from '../client'
import type { LoadedConfig } from './config'

export interface ReleaseRef {
  id: number
  name: string
}

/** The config's `release` with its id; null when the config names none. */
export async function resolveRelease(
  loaded: LoadedConfig,
  client: LocalnessClient,
): Promise<ReleaseRef | null> {
  const name = loaded.config.release
  if (!name) return null
  const { releases } = await client.meta()
  const found = findRelease(releases, name)
  if (!found) {
    throw new Error(
      `The project has no release "${name}" (${loaded.path}); run "localness releases" to list them.`,
    )
  }
  return { id: Number(found.id), name: found.name }
}
