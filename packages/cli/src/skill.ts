import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findConfigFile } from '@localness/sdk/sync'
import { version } from '../package.json'
import { EXIT_ERROR, list, type CliIo, type CliValues } from './shared'

const SKILL_NAME = 'localness'
const TEMPLATE_DIR = fileURLToPath(new URL('../skill/', import.meta.url))
const SKILL_FILE = 'SKILL.md'
const REFERENCES = 'references'

/** Folders each agent reads project skills from, its own first. */
const AGENT_READS = {
  copilot: ['.github/skills', '.claude/skills', '.agents/skills'],
  claude: ['.claude/skills'],
  cursor: ['.cursor/skills', '.claude/skills', '.agents/skills'],
  codex: ['.agents/skills'],
} as const satisfies Record<string, readonly string[]>

export type SkillAgent = keyof typeof AGENT_READS

const AGENTS = Object.keys(AGENT_READS) as SkillAgent[]
const DEFAULT_AGENTS: SkillAgent[] = ['copilot', 'claude', 'cursor']
/** Tie-break order: the vendor-neutral folder first. */
const SKILL_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.github/skills',
  '.cursor/skills',
]

/**
 * The fewest folders every agent reads from: one copy per agent would show the
 * skill twice to agents that read several folders.
 */
export function skillDirsFor(agents: readonly SkillAgent[]) {
  const left = new Set(agents)
  const dirs: string[] = []
  while (left.size > 0) {
    let best = ''
    let bestScore = 0
    for (const dir of SKILL_DIRS) {
      const readers = [...left].filter((agent) =>
        (AGENT_READS[agent] as readonly string[]).includes(dir),
      )
      const own = readers.some((agent) => AGENT_READS[agent][0] === dir)
      const score = readers.length + (own ? 0.5 : 0)
      if (score > bestScore) {
        best = dir
        bestScore = score
      }
    }
    dirs.push(best)
    for (const agent of left) {
      if ((AGENT_READS[agent] as readonly string[]).includes(best)) {
        left.delete(agent)
      }
    }
  }
  return dirs
}

function parseAgents(value: string | undefined): SkillAgent[] {
  const names = list(value)
  if (!names) return DEFAULT_AGENTS
  if (names.includes('all')) return AGENTS
  for (const name of names) {
    if (!AGENTS.includes(name as SkillAgent)) {
      throw new Error(
        `Unknown agent: ${name}. Use ${AGENTS.join(', ')} or all.`,
      )
    }
  }
  return names as SkillAgent[]
}

const HASH_FIELD = /localness-hash: ["'][^"']*["']/
const VERSION_FIELD = /localness-cli: ["']([^"']*)["']/

/** Paths relative to the skill folder, with `/`; `SKILL.md` first. */
export type SkillFiles = Map<string, string>

const normalize = (text: string) => text.replace(/\r\n/g, '\n')

/**
 * Over SKILL.md without its own hash, then every reference, ignoring line
 * endings git may change. Without references it is the hash of SKILL.md
 * alone, as single-file installs recorded it.
 */
function hashOf(files: SkillFiles) {
  const hash = createHash('sha256').update(
    normalize(files.get(SKILL_FILE) ?? '').replace(
      HASH_FIELD,
      "localness-hash: ''",
    ),
  )
  const references = [...files.keys()].filter((path) => path !== SKILL_FILE)
  for (const path of references.sort()) {
    hash.update(`\0${path}\n${normalize(files.get(path)!)}`)
  }
  return hash.digest('hex').slice(0, 16)
}

/** SKILL.md and the files under `references/`; null without SKILL.md. */
async function readSkillFolder(dir: string): Promise<SkillFiles | null> {
  const skill = await readOptional(join(dir, SKILL_FILE))
  if (skill === null) return null
  const files: SkillFiles = new Map([[SKILL_FILE, skill]])
  const entries = await readdir(join(dir, REFERENCES), {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = `${REFERENCES}/${entry.name}`
    files.set(path, await readFile(join(dir, REFERENCES, entry.name), 'utf8'))
  }
  return files
}

export async function renderSkill(): Promise<SkillFiles> {
  const files = (await readSkillFolder(TEMPLATE_DIR))!
  for (const [path, text] of files) files.set(path, normalize(text))
  files.set(SKILL_FILE, files.get(SKILL_FILE)!.replace('{{version}}', version))
  const hash = hashOf(files)
  files.set(
    SKILL_FILE,
    files.get(SKILL_FILE)!.replace(HASH_FIELD, `localness-hash: '${hash}'`),
  )
  return files
}

export interface InstalledSkill {
  version: string | null
  /** Edited since it was installed, or not written by this command. */
  modified: boolean
}

export function readInstalledSkill(files: SkillFiles): InstalledSkill {
  const text = files.get(SKILL_FILE) ?? ''
  const hash = /localness-hash: ["']([0-9a-f]*)["']/.exec(text)?.[1]
  return {
    version: VERSION_FIELD.exec(text)?.[1] ?? null,
    modified: !hash || hash !== hashOf(files),
  }
}

function sameFiles(a: SkillFiles, b: SkillFiles) {
  return (
    a.size === b.size &&
    [...a].every(([path, text]) => normalize(b.get(path) ?? '\0') === text)
  )
}

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function readOptional(path: string) {
  return readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
}

/** The git root above `dir`, where agents look for skills; else `dir`. */
export async function repoRoot(dir: string) {
  for (let current = dir; ;) {
    if (await exists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return dir
    current = parent
  }
}

async function startDir(io: CliIo, values: CliValues) {
  const config = values.config ?? (await findConfigFile(io.cwd))
  return config ? dirname(resolve(io.cwd, config)) : io.cwd
}

async function rootFor(io: CliIo, values: CliValues) {
  if (values.root) return resolve(io.cwd, values.root)
  return repoRoot(await startDir(io, values))
}

function skillFolder(root: string, dir: string) {
  return join(root, ...dir.split('/'), SKILL_NAME)
}

/** Installed copies under `root`, in any folder an agent reads. */
export async function findInstalledSkills(root: string) {
  const found: { dir: string; path: string; skill: InstalledSkill }[] = []
  for (const dir of SKILL_DIRS) {
    const folder = skillFolder(root, dir)
    const files = await readSkillFolder(folder)
    if (files !== null) {
      const path = join(folder, SKILL_FILE)
      found.push({ dir, path, skill: readInstalledSkill(files) })
    }
  }
  return found
}

/** One line on stderr when an installed copy came from another CLI version. */
export async function warnOutdatedSkill(io: CliIo, values: CliValues) {
  const start = await startDir(io, values)
  const root = await repoRoot(start)
  // Every folder from the config up to the git root, where --root may have put it.
  for (let dir = start; ; dir = dirname(dir)) {
    const outdated = (await findInstalledSkills(dir)).find(
      ({ skill }) => skill.version !== null && skill.version !== version,
    )
    if (outdated) {
      const flag = dir === root ? '' : ` --root ${relative(io.cwd, dir) || '.'}`
      io.stderr(
        `localness: the Agent Skill in ${relative(io.cwd, dirname(outdated.path)) || '.'} is for CLI ${outdated.skill.version}, this is ${version}; run "localness skill install${flag}" to update it.\n`,
      )
      return
    }
    if (dir === root || dirname(dir) === dir) return
  }
}

const AGENTS_MD = 'AGENTS.md'
const BLOCK_START = '<!-- localness:start -->'
const BLOCK_END = '<!-- localness:end -->'

function agentsBlock(skillFile: string) {
  return `${BLOCK_START}
## Localness

The locale JSON files are synced with a Localness project. Before changing them, read \`${skillFile}\` and follow it: move text only with the \`localness\` CLI, show a person the plan before \`localness apply\`, and never settle a conflict on your own.
${BLOCK_END}`
}

/** Replaces the marked block, or appends one. */
export function withAgentsBlock(text: string | null, block: string) {
  if (text === null) return `${block}\n`
  const start = text.indexOf(BLOCK_START)
  const end = text.indexOf(BLOCK_END)
  if (start !== -1 && end > start) {
    return `${text.slice(0, start)}${block}${text.slice(end + BLOCK_END.length)}`
  }
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`
}

type Action = 'created' | 'updated' | 'unchanged' | 'modified'

export async function runSkill(
  io: CliIo,
  values: CliValues,
  subcommand: string | undefined,
) {
  if (subcommand !== 'install') {
    throw new Error(
      `Unknown skill command: ${subcommand ?? '(none)'}. Run "localness skill install".`,
    )
  }
  const agents = parseAgents(values.agent)
  const root = await rootFor(io, values)
  const content = await renderSkill()
  const dryRun = values['dry-run'] ?? false
  const force = values.force ?? false

  const installed = await findInstalledSkills(root)
  const dirs = [
    ...new Set([...skillDirsFor(agents), ...installed.map(({ dir }) => dir)]),
  ]
  const results: { path: string; action: Action }[] = []
  for (const dir of dirs) {
    const folder = skillFolder(root, dir)
    const current = await readSkillFolder(folder)
    let action: Action
    if (current === null) action = 'created'
    else if (sameFiles(content, current)) action = 'unchanged'
    else if (readInstalledSkill(current).modified && !force) action = 'modified'
    else action = 'updated'
    if (!dryRun && (action === 'created' || action === 'updated')) {
      for (const path of current?.keys() ?? []) {
        if (!content.has(path)) await rm(join(folder, path), { force: true })
      }
      for (const [path, text] of content) {
        const target = join(folder, path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, text, 'utf8')
      }
    }
    results.push({ path: relative(io.cwd, join(folder, SKILL_FILE)), action })
  }

  let agentsMd: string | null = null
  if (values['agents-md']) {
    const path = join(root, AGENTS_MD)
    const skillFile = relative(
      root,
      join(skillFolder(root, dirs[0]!), SKILL_FILE),
    ).replace(/\\/g, '/')
    const current = await readOptional(path)
    const next = withAgentsBlock(current, agentsBlock(skillFile))
    if (!dryRun && next !== current) await writeFile(path, next, 'utf8')
    agentsMd = relative(io.cwd, path)
  }

  const refused = results.filter(({ action }) => action === 'modified')
  if (values.json) {
    io.stdout(
      `${JSON.stringify({ version, agents, dryRun, skills: results, agentsMd }, null, 2)}\n`,
    )
  } else {
    for (const { path, action } of results) {
      io.stdout(
        action === 'modified'
          ? `  kept ${path}: edited by hand; --force overwrites it\n`
          : `  ${dryRun && action !== 'unchanged' ? `would be ${action}` : action} ${path}\n`,
      )
    }
    if (agentsMd) {
      io.stdout(`  ${dryRun ? 'would update' : 'updated'} ${agentsMd}\n`)
    }
    io.stdout(
      dryRun
        ? `Dry run: Agent Skill ${version} for ${agents.join(', ')}.\n`
        : `Agent Skill ${version} for ${agents.join(', ')}. Commit it so every checkout's agents get it.\n`,
    )
  }
  return refused.length > 0 ? EXIT_ERROR : 0
}
