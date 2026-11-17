import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const TOKEN_ENV = 'LOCALNESS_TOKEN'
export const ENV_FILE = '.env.local'

/** `KEY=value` lines of a dotenv file; `#` comments, `export` and quotes allowed. */
export function parseEnvFile(source: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2]!.trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/, '')
    }
    values[match[1]!] = value
  }
  return values
}

/**
 * `LOCALNESS_TOKEN` from `dir/.env.local`, else from `env`; undefined when
 * neither has one. `dir` is the folder of `localness.config.json`.
 */
export async function findEnvToken(
  dir: string,
  env: Record<string, string | undefined>,
): Promise<string | undefined> {
  const source = await readFile(join(dir, ENV_FILE), 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    },
  )
  const fromFile = source && parseEnvFile(source)[TOKEN_ENV]?.trim()
  return fromFile || env[TOKEN_ENV]?.trim() || undefined
}
