import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createClient, type FetchLike } from '@localness/sdk'
import { findConfigFile, loadConfig } from '@localness/sdk/sync'
import { version } from '../package.json'
import { ENV_FILE, TOKEN_ENV, findEnvToken } from './env'

export interface CliIo {
  cwd: string
  env: Record<string, string | undefined>
  stdout(text: string): void
  stderr(text: string): void
  /** Asks the person at the terminal; absent when nobody can answer. */
  prompt?(question: string): Promise<string>
  fetch?: FetchLike
}

/**
 * Exit codes: 0 done, 1 `diff` found differences or `pull`/`sync` left keys
 * for a person (unrouted, duplicate), 2 failed.
 */
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
  into: { type: 'string' },
  pattern: { type: 'string' },
  format: { type: 'string' },
  force: { type: 'boolean' },
  agent: { type: 'string' },
  'agents-md': { type: 'boolean' },
  root: { type: 'string' },
  release: { type: 'string' },
  none: { type: 'boolean' },
  use: { type: 'boolean' },
  match: { type: 'string' },
  timeout: { type: 'string' },
  open: { type: 'string' },
  yes: { type: 'boolean', short: 'y' },
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

export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** Config problems the comparison found; they never stop a command. */
export function printWarnings(io: CliIo, warnings: readonly string[]) {
  for (const warning of warnings) io.stderr(`localness: ${warning}\n`)
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

const AGENT_ENV = 'LOCALNESS_AGENT'

/** Variables coding agents set in the shells they run; their value is not checked. */
const AGENT_MARKERS = [
  'AI_AGENT',
  'CLAUDECODE',
  'CURSOR_AGENT',
  'COPILOT_CLI',
  'CODEX_SANDBOX',
  'GEMINI_CLI',
]

/**
 * `cli/<version>`, plus `; agent` when an agent runs it, so the project's
 * history can tell. `LOCALNESS_AGENT=1` or `0` overrides the detection.
 */
export function clientOf(env: CliIo['env']) {
  const flag = env[AGENT_ENV]
  const agent =
    flag !== undefined && flag !== ''
      ? flag !== '0'
      : AGENT_MARKERS.some((name) => env[name])
  return `cli/${version}${agent ? '; agent' : ''}`
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
    client: clientOf(io.env),
    fetch: io.fetch,
  })
  return { loaded, client }
}
