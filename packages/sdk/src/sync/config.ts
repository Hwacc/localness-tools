import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  DEFAULT_LOCALE_FILE_PATTERN,
  LocaleFileFormat,
  localeFilesScopeError,
} from '@localness/contract/locale-file'
import { z } from 'zod'

export const CONFIG_FILE_NAME = 'localness.config.json'

/** `published` matches what `/bundle` serves; `draft` previews unpublished edits. */
export const SYNC_CONTENTS = ['published', 'draft'] as const
export type SyncContent = (typeof SYNC_CONTENTS)[number]

const filesSchema = z
  .object({
    /** Relative to the config file. */
    dir: z.string(),
    pattern: z.string().default(DEFAULT_LOCALE_FILE_PATTERN),
    format: z.enum(LocaleFileFormat).default(LocaleFileFormat.NESTED_JSON),
  })
  .superRefine((files, ctx) => {
    const error = localeFilesScopeError(files.dir, files.pattern)
    if (error) ctx.addIssue({ code: 'custom', message: error })
  })

/**
 * `localness.config.json`, shared by the CLI and the VS Code extension. Tokens
 * never go here.
 */
export const localnessConfigSchema = z.object({
  $schema: z.string().optional(),
  baseUrl: z.string().trim().min(1),
  /** Project id or name. Optional when the token reaches one project. */
  project: z
    .union([z.string().trim().min(1), z.number().int().positive()])
    .optional(),
  /** Local locale files, laid out like git-sync's `locale-files`. */
  files: filesSchema.optional(),
  /** Platform locale codes to sync. Omit for every project locale. */
  locales: z.array(z.string().min(1)).optional(),
  /** Platform locale → file name, when `zh_cn` → `zh-CN` is not the name. */
  localeMap: z.record(z.string(), z.string().min(1)).optional(),
  content: z.enum(SYNC_CONTENTS).default('published'),
  /** Release name new keys are labelled with. Existing keys keep their labels. */
  release: z.string().trim().min(1).optional(),
  /** Extra regular expressions finding keys in code; the key is capture group 1. */
  keyPatterns: z.array(z.string()).default([]),
  useDefaultKeyPatterns: z.boolean().default(true),
  /** Code written by the VS Code extract command, per site. */
  extractTemplates: z.record(z.string(), z.string()).optional(),
})

export type LocalnessConfig = z.output<typeof localnessConfigSchema>
export type LocalnessConfigInput = z.input<typeof localnessConfigSchema>
export type LocalnessFilesConfig = NonNullable<LocalnessConfig['files']>

export interface LoadedConfig {
  /** Absolute path of the config file. */
  path: string
  /** Its directory, which `files.dir` is relative to. */
  root: string
  config: LocalnessConfig
}

export function parseConfig(source: string, path = CONFIG_FILE_NAME) {
  let json: unknown
  try {
    json = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const parsed = localnessConfigSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`${path} is invalid:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

/** The nearest config file at or above `from`. */
export async function findConfigFile(
  from: string,
): Promise<string | undefined> {
  let dir = resolve(from)
  while (true) {
    const candidate = join(dir, CONFIG_FILE_NAME)
    const found = await stat(candidate).then(
      (info) => info.isFile(),
      () => false,
    )
    if (found) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export async function loadConfig(path: string): Promise<LoadedConfig> {
  const absolute = resolve(path)
  const source = await readFile(absolute, 'utf8')
  return {
    path: absolute,
    root: dirname(absolute),
    config: parseConfig(source, absolute),
  }
}

/**
 * The config text with `fields` set; an undefined field is removed. Other
 * fields and their order are kept; a missing file starts empty.
 */
export function withConfigFields(
  source: string | undefined,
  fields: Record<string, unknown>,
): string {
  const config: unknown = source === undefined ? {} : JSON.parse(source)
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error(`${CONFIG_FILE_NAME} must contain a JSON object.`)
  }
  return `${JSON.stringify({ ...config, ...fields }, null, 2)}\n`
}

export async function writeConfigFields(
  path: string,
  fields: Record<string, unknown>,
) {
  const source = await readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  const next = withConfigFields(source, fields)
  if (next !== source) await writeFile(path, next, 'utf8')
}

export function requireFiles(loaded: LoadedConfig): LocalnessFilesConfig {
  if (!loaded.config.files) {
    throw new Error(
      `${loaded.path} has no "files" section; run "localness init" or add { "files": { "dir": "src/locales" } }.`,
    )
  }
  return loaded.config.files
}
