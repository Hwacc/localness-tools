import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { findConfigFile } from '@localness/sdk/sync'
import { version } from '../package.json'
import { EXIT_ERROR, list, type CliIo, type CliValues } from './shared'

const SKILL_NAME = 'localness'
const TEMPLATE = new URL('../skill/SKILL.md', import.meta.url)

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

/** Over the file without its own hash, ignoring line endings git may change. */
function hashOf(text: string) {
  return createHash('sha256')
    .update(
      text.replace(/\r\n/g, '\n').replace(HASH_FIELD, "localness-hash: ''"),
    )
    .digest('hex')
    .slice(0, 16)
}

export async function renderSkill() {
  const text = (await readFile(TEMPLATE, 'utf8'))
    .replace(/\r\n/g, '\n')
    .replace('{{version}}', version)
  return text.replace(HASH_FIELD, `localness-hash: '${hashOf(text)}'`)
}

export interface InstalledSkill {
  version: string | null
  /** Edited since it was installed, or not written by this command. */
  modified: boolean
}

export function readInstalledSkill(text: string): InstalledSkill {
  const hash = /localness-hash: ["']([0-9a-f]*)["']/.exec(text)?.[1]
  return {
    version: VERSION_FIELD.exec(text)?.[1] ?? null,
    modified: !hash || hash !== hashOf(text),
  }
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

function skillPath(root: string, dir: string) {
  return join(root, ...dir.split('/'), SKILL_NAME, 'SKILL.md')
}

/** Installed copies under `root`, in any folder an agent reads. */
export async function findInstalledSkills(root: string) {
  const found: { dir: string; path: string; skill: InstalledSkill }[] = []
  for (const dir of SKILL_DIRS) {
    const path = skillPath(root, dir)
    const text = await readOptional(path)
    if (text !== null)
      found.push({ dir, path, skill: readInstalledSkill(text) })
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
    const path = skillPath(root, dir)
    const current = await readOptional(path)
    let action: Action
    if (current === null) action = 'created'
    else if (current.replace(/\r\n/g, '\n') === content) action = 'unchanged'
    else if (readInstalledSkill(current).modified && !force) action = 'modified'
    else action = 'updated'
    if (!dryRun && (action === 'created' || action === 'updated')) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    }
    results.push({ path: relative(io.cwd, path), action })
  }

  let agentsMd: string | null = null
  if (values['agents-md']) {
    const path = join(root, AGENTS_MD)
    const skillFile = relative(root, skillPath(root, dirs[0]!)).replace(
      /\\/g,
      '/',
    )
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
