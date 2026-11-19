import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  STATE_DIR,
  findConfigFile,
  loadConfig,
  readLocalFiles,
  type LoadedConfig,
} from '@localness/sdk/sync'
import { lookupTexts } from '../lookup'
import { loadProject, plural, type CliIo, type CliValues } from '../shared'
import {
  parseReviewInput,
  type ReviewDoc,
  type ReviewResult,
  type ReviewRow,
} from './model'
import { startReviewServer } from './server'

const USAGE =
  'Usage: localness review start <file> | localness review wait <id> [--timeout <seconds>]'
const START_WAIT_MS = 15_000
const DEFAULT_WAIT_S = 90
// Nobody answered by then: the page gave up, so its server should too.
const SERVE_TTL_MS = 2 * 60 * 60 * 1000
const KEEP_MS = 24 * 60 * 60 * 1000

interface ServerInfo {
  url?: string
  pid?: number
  error?: string
}

function reviewDir(loaded: LoadedConfig) {
  return join(loaded.root, STATE_DIR, 'review')
}

function paths(loaded: LoadedConfig, id: string) {
  if (!/^[a-f0-9]{8}$/.test(id)) throw new Error(`Invalid review id: ${id}`)
  const dir = reviewDir(loaded)
  return {
    doc: join(dir, `${id}.json`),
    server: join(dir, `${id}.server.json`),
    result: join(dir, `${id}.result.json`),
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  const source = await readFile(path, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  return source === null ? null : (JSON.parse(source) as T)
}

const writeJson = (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

async function prepareDir(loaded: LoadedConfig, now: number) {
  const dir = reviewDir(loaded)
  await mkdir(dir, { recursive: true })
  await writeFile(join(loaded.root, STATE_DIR, '.gitignore'), '*\n', {
    flag: 'wx',
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  for (const name of await readdir(dir)) {
    const path = join(dir, name)
    const { mtimeMs } = await stat(path)
    if (now - mtimeMs > KEEP_MS) await rm(path, { force: true })
  }
}

async function snippetOf(path: string, line: number | undefined) {
  if (!line) return undefined
  const source = await readFile(path, 'utf8').catch(() => null)
  const text = source?.split(/\r?\n/)[line - 1]?.trim()
  return text ? text.slice(0, 200) : undefined
}

function editorOf(env: CliIo['env']): ReviewDoc['editor'] {
  return env.CURSOR_TRACE_ID ||
    env.CURSOR_AGENT ||
    /cursor/i.test(env.VSCODE_GIT_ASKPASS_MAIN ?? '')
    ? 'cursor'
    : 'vscode'
}

function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

function isAlive(pid: number | undefined) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function runStart(io: CliIo, values: CliValues, file: string) {
  const input = parseReviewInput(
    JSON.parse(await readFile(resolve(io.cwd, file), 'utf8')),
  )
  const { loaded, meta, matches } = await lookupTexts(
    io,
    values,
    input.map((item) => item.text),
  )
  const now = Date.now()
  await prepareDir(loaded, now)
  const id = randomBytes(4).toString('hex')
  const rows: ReviewRow[] = await Promise.all(
    input.map(async (item, index) => {
      const path = item.file ? resolve(io.cwd, item.file) : undefined
      return {
        index: index + 1,
        text: item.text,
        file: item.file,
        line: item.line,
        path,
        snippet: path ? await snippetOf(path, item.line) : undefined,
        candidates: matches[index]!.keys.map((hit) => ({
          key: hit.key,
          sourceText: hit.sourceText,
          source: hit.source,
          ...(hit.source === 'platform' && hit.draft && { draft: true }),
        })),
        suggestion: item.key?.trim() ?? '',
      }
    }),
  )
  const doc: ReviewDoc = {
    id,
    createdAt: new Date(now).toISOString(),
    project: meta.project?.name ?? String(loaded.config.project ?? ''),
    sourceLocale: meta.sourceLocale ?? '',
    editor: editorOf(io.env),
    convention: meta.keyConvention ?? null,
    namespaces: (meta.namespaces ?? []).map((namespace) => namespace.name),
    rows,
  }
  const files = paths(loaded, id)
  await writeJson(files.doc, doc)

  const args = [process.argv[1]!, 'review', 'serve', id]
  if (values.config) args.push('--config', resolve(io.cwd, values.config))
  const child = spawn(process.execPath, args, {
    cwd: io.cwd,
    env: io.env as NodeJS.ProcessEnv,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()

  let info: ServerInfo | null = null
  for (let waited = 0; waited < START_WAIT_MS && !info; waited += 200) {
    await sleep(200)
    info = await readJson<ServerInfo>(files.server).catch(() => null)
  }
  if (!info?.url) {
    throw new Error(
      info?.error ?? 'The review page did not start; check the review file.',
    )
  }
  openBrowser(info.url)
  if (values.json) {
    io.stdout(`${JSON.stringify({ id, url: info.url, rows: rows.length })}\n`)
  } else {
    io.stdout(
      `Review ${id}: ${plural(rows.length, 'text')}, opened in the browser:\n  ${info.url}\n` +
        `Run "localness review wait ${id}" for the decisions.\n`,
    )
  }
  return 0
}

async function runServe(io: CliIo, values: CliValues, id: string) {
  const { loaded, client } = await loadProject(io, values)
  const files = paths(loaded, id)
  try {
    const doc = await readJson<ReviewDoc>(files.doc)
    if (!doc) throw new Error(`No review ${id}.`)
    const taken = async (names: string[]) => {
      const found = new Set<string>()
      if (names.length === 0) return found
      const [local] =
        loaded.config.files && doc.sourceLocale
          ? await readLocalFiles(loaded, [doc.sourceLocale])
          : []
      for (const name of names) {
        if (local && name in local.content.entries) found.add(name)
      }
      const { keys } = await client.keyStates({
        keys: names,
        locales: doc.sourceLocale ? [doc.sourceLocale] : undefined,
      })
      for (const { key } of keys) found.add(key)
      return found
    }
    const review = await startReviewServer({
      doc,
      taken,
      onDone: (result) => writeJson(files.result, result),
    })
    await writeJson(files.server, { url: review.url, pid: process.pid })
    const expire = setTimeout(async () => {
      await writeJson(files.result, {
        id,
        status: 'cancelled',
        items: [],
      } satisfies ReviewResult)
      review.server.close()
      review.server.closeAllConnections()
    }, SERVE_TTL_MS)
    await Promise.race([
      review.done,
      new Promise((done) => review.server.once('close', done)),
    ])
    clearTimeout(expire)
    review.server.close()
    review.server.closeAllConnections()
    return 0
  } catch (error) {
    await writeJson(files.server, {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function runWait(io: CliIo, values: CliValues, id: string) {
  const timeout =
    values.timeout === undefined ? DEFAULT_WAIT_S : Number(values.timeout)
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new Error('--timeout takes a number of seconds.')
  }
  const config = values.config ?? (await findConfigFile(io.cwd))
  if (!config) throw new Error('No localness.config.json here or above.')
  const files = paths(await loadConfig(config), id)
  const until = Date.now() + timeout * 1000
  for (;;) {
    const result = await readJson<ReviewResult>(files.result)
    if (result) {
      io.stdout(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }
    const info = await readJson<ServerInfo>(files.server)
    if (!info) throw new Error(`No review ${id} here.`)
    if (!isAlive(info.pid)) {
      throw new Error(
        `The review page for ${id} stopped without an answer; start a new review.`,
      )
    }
    if (Date.now() >= until) {
      io.stdout(
        `${JSON.stringify({ id, status: 'pending', url: info.url }, null, 2)}\n`,
      )
      io.stderr(
        `Nothing decided yet; run "localness review wait ${id}" again.\n`,
      )
      return 0
    }
    await sleep(500)
  }
}

/** An interactive page where the person decides, per extracted text, which key it gets. */
export async function runReview(
  io: CliIo,
  values: CliValues,
  [sub, arg, ...extra]: string[],
) {
  if (!sub || !arg || extra.length > 0) throw new Error(USAGE)
  switch (sub) {
    case 'start':
      return runStart(io, values, arg)
    case 'wait':
      return runWait(io, values, arg)
    case 'serve':
      return runServe(io, values, arg)
    default:
      throw new Error(USAGE)
  }
}
