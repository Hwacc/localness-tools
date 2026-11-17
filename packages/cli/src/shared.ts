import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createClient, type FetchLike } from '@localness/sdk'
import { findConfigFile, loadConfig } from '@localness/sdk/sync'
import { ENV_FILE, TOKEN_ENV, findEnvToken } from './env'

export interface CliIo {
  cwd: string
  env: Record<string, string | undefined>
  stdout(text: string): void
  stderr(text: string): void
  fetch?: FetchLike
}

/** Exit codes: 0 done, 1 `diff` found differences, 2 failed. */
export const EXIT_DIFFERENT = 1
export const EXIT_ERROR = 2

export const OPTIONS = {
  config: { type: 'string' },
  keys: { type: 'string' },
  locales: { type: 'string' },
  prune: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  json: { type: 'boolean' },
  'base-url': { type: 'string' },
  project: { type: 'string' },
  dir: { type: 'string' },
  pattern: { type: 'string' },
  format: { type: 'string' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

export type CliValues = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>['values']

export function list(value: string | undefined) {
  if (value === undefined) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

export async function readToken(io: CliIo, dir: string) {
  const token = await findEnvToken(dir, io.env)
  if (!token) {
    throw new Error(
      `Set ${TOKEN_ENV} to a Localness API token in ${join(dir, ENV_FILE)} or the environment.`,
    )
  }
  return token
}

export async function loadProject(io: CliIo, values: CliValues) {
  const path = values.config ?? (await findConfigFile(io.cwd))
  if (!path) {
    throw new Error(
      'No localness.config.json here or above; run "localness init" first.',
    )
  }
  const loaded = await loadConfig(path)
  const client = createClient({
    baseUrl: loaded.config.baseUrl,
    token: await readToken(io, loaded.root),
    project: loaded.config.project,
    fetch: io.fetch,
  })
  return { loaded, client }
}
