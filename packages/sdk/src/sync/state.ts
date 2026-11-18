import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SYNC_CONTENTS, type LoadedConfig } from './config'

/** Next to the config; ignores itself, so nothing here is committed. */
export const STATE_DIR = '.localness'
const BASE_FILE = 'base.json'
const PLANS_DIR = 'plans'

export const MAX_PLAN_KEYS = 200
export const PLAN_TTL_MS = 60 * 60 * 1000

/** Per locale, per key: the text both sides last agreed on. */
export type BaseTexts = Record<string, Record<string, string>>

/** Base and plans only hold for the project and content they were made for. */
const originSchema = z.object({
  baseUrl: z.string(),
  project: z.union([z.string(), z.number()]).nullable(),
  content: z.enum(SYNC_CONTENTS),
})
type Origin = z.output<typeof originSchema>

const baseFileSchema = originSchema.extend({
  version: z.literal(1),
  texts: z.record(z.string(), z.record(z.string(), z.string())),
})

const pushLocaleSchema = z.object({
  text: z.string(),
  /** The project's text and draft when planned; apply refuses if either moved. */
  platform: z.string().nullable(),
  draft: z.string().nullable(),
})

const pushKeySchema = z.object({
  key: z.string(),
  /** Set when the project lacks the key: created with this source text, published. */
  create: z.object({ sourceText: z.string() }).nullable(),
  /** Drafts to write, per locale. */
  locales: z.record(z.string(), pushLocaleSchema),
})

export const PUSH_BLOCK_REASONS = ['no-source-text', 'reserved-name'] as const

export const pushPlanSchema = originSchema.extend({
  version: z.literal(1),
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  sourceLocale: z.string(),
  /** The release created keys are labelled with. */
  release: z
    .object({ id: z.number(), name: z.string() })
    .nullable()
    .default(null),
  keys: z.array(pushKeySchema),
  blocked: z.array(
    z.object({
      locale: z.string(),
      key: z.string(),
      reason: z.enum(PUSH_BLOCK_REASONS),
    }),
  ),
})

export type PushPlan = z.output<typeof pushPlanSchema>
export type PushKey = PushPlan['keys'][number]
export type PushBlocked = PushPlan['blocked'][number]

export function originOf(loaded: LoadedConfig): Origin {
  return {
    baseUrl: loaded.config.baseUrl,
    project: loaded.config.project ?? null,
    content: loaded.config.content,
  }
}

function sameOrigin(a: Origin, b: Origin) {
  return (
    a.baseUrl === b.baseUrl &&
    a.project === b.project &&
    a.content === b.content
  )
}

function stateDir(loaded: LoadedConfig) {
  return join(loaded.root, STATE_DIR)
}

async function ensureDir(loaded: LoadedConfig, ...parts: string[]) {
  const dir = stateDir(loaded)
  await mkdir(join(dir, ...parts), { recursive: true })
  await writeFile(join(dir, '.gitignore'), '*\n', { flag: 'wx' }).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    },
  )
  return dir
}

async function readText(path: string) {
  return readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** Null when there is none yet, or it was made for another project or content. */
export async function readBase(
  loaded: LoadedConfig,
): Promise<BaseTexts | null> {
  const source = await readText(join(stateDir(loaded), BASE_FILE))
  if (source === null) return null
  let data: unknown
  try {
    data = JSON.parse(source)
  } catch {
    return null
  }
  const parsed = baseFileSchema.safeParse(data)
  if (!parsed.success || !sameOrigin(parsed.data, originOf(loaded))) return null
  return parsed.data.texts
}

export async function writeBase(loaded: LoadedConfig, texts: BaseTexts) {
  const dir = await ensureDir(loaded)
  await writeFile(
    join(dir, BASE_FILE),
    json({ version: 1, ...originOf(loaded), texts }),
    'utf8',
  )
}

export function newPlanId() {
  return randomBytes(4).toString('hex')
}

function planPath(loaded: LoadedConfig, id: string) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`Invalid plan id: ${id}`)
  return join(stateDir(loaded), PLANS_DIR, `${id}.json`)
}

/** Returns the plan's path. */
export async function savePlan(loaded: LoadedConfig, plan: PushPlan) {
  await ensureDir(loaded, PLANS_DIR)
  const path = planPath(loaded, plan.id)
  await writeFile(path, json(plan), 'utf8')
  return path
}

export async function loadPlan(
  loaded: LoadedConfig,
  id: string,
): Promise<PushPlan> {
  const source = await readText(planPath(loaded, id))
  if (source === null) {
    throw new Error(`No plan ${id}; run "localness push" to make one.`)
  }
  const parsed = pushPlanSchema.safeParse(JSON.parse(source))
  if (!parsed.success) throw new Error(`Plan ${id} is not readable.`)
  if (!sameOrigin(parsed.data, originOf(loaded))) {
    throw new Error(
      `Plan ${id} was made for another project or content; run "localness push" again.`,
    )
  }
  return parsed.data
}

async function planIds(loaded: LoadedConfig) {
  const names = await readdir(join(stateDir(loaded), PLANS_DIR)).catch(
    (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    },
  )
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
}

export async function listPlans(loaded: LoadedConfig): Promise<PushPlan[]> {
  const plans: PushPlan[] = []
  for (const id of await planIds(loaded)) {
    const plan = await loadPlan(loaded, id).catch(() => null)
    if (plan) plans.push(plan)
  }
  return plans.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function deletePlan(loaded: LoadedConfig, id: string) {
  await rm(planPath(loaded, id), { force: true })
}

/**
 * Deletes expired plans, whatever project or content they were made for, and
 * returns their ids. Plans it cannot read are left alone.
 */
export async function prunePlans(loaded: LoadedConfig, now = new Date()) {
  const pruned: string[] = []
  for (const id of await planIds(loaded)) {
    let path: string
    let expiresAt: number
    try {
      path = planPath(loaded, id)
      const source = await readText(path)
      if (source === null) continue
      expiresAt = Date.parse(pushPlanSchema.parse(JSON.parse(source)).expiresAt)
    } catch {
      continue
    }
    if (now.getTime() > expiresAt) {
      await rm(path, { force: true })
      pruned.push(id)
    }
  }
  return pruned
}
