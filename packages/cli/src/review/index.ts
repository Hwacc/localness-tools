import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  buildResolveRows,
  claimReview,
  hasEditor,
  isAlive,
  parseReviewInput,
  prepareReviewDir,
  readJson,
  reviewPaths,
  takenNames,
  toResolveResult,
  toResult,
  writeJson,
  type ResolveReviewDoc,
  type ReviewClaim,
  type ReviewDoc,
  type ReviewResult,
  type ReviewRow,
} from '@localness/sdk/review'
import {
  compareLocaleFiles,
  findConfigFile,
  loadConfig,
} from '@localness/sdk/sync'
import { lookupTexts } from '../lookup'
import {
  configField,
  list,
  loadProject,
  plural,
  printWarnings,
  type CliIo,
  type CliValues,
} from '../shared'
import { startReviewServer } from './server'

const USAGE =
  'Usage: localness review start <file> [--open auto|browser|editor] | localness review start --kind resolve [--locales <a,b>] [--keys <a,b>] [--open auto|browser|editor] | localness review wait <id> [--timeout <seconds>]'
const OPEN_MODES = ['auto', 'browser', 'editor']
const START_WAIT_MS = 15_000
// How long an editor gets to pick the review up before the browser does.
const CLAIM_WAIT_MS = 3_000
const DEFAULT_WAIT_S = 90
// Nobody answered by then: the page gave up, so its server should too.
const SERVE_TTL_MS = 2 * 60 * 60 * 1000

async function waitForClaim(path: string, ms: number) {
  for (let waited = 0; waited < ms; waited += 200) {
    await sleep(200)
    const claim = await readJson<ReviewClaim>(path).catch(() => null)
    if (claim) return claim
  }
  return null
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

async function runStart(io: CliIo, values: CliValues, file: string) {
  const open = values.open ?? 'auto'
  if (!OPEN_MODES.includes(open)) {
    throw new Error('--open takes auto, browser or editor.')
  }
  const input = parseReviewInput(
    JSON.parse(await readFile(resolve(io.cwd, file), 'utf8')),
  )
  const { loaded, meta, matches } = await lookupTexts(
    io,
    values,
    input.map((item) => item.text),
  )
  const now = Date.now()
  await prepareReviewDir(loaded.root, now)
  const inEditor = open !== 'browser' && (await hasEditor(loaded.root))
  if (open === 'editor' && !inEditor) {
    throw new Error(
      'No VS Code or Cursor window with the Localness extension has this project open.',
    )
  }
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
    open: inEditor ? 'editor' : 'browser',
  }
  return present(io, values, loaded.root, doc, open)
}

async function runResolveStart(io: CliIo, values: CliValues) {
  const open = values.open ?? 'auto'
  if (!OPEN_MODES.includes(open)) {
    throw new Error('--open takes auto, browser or editor.')
  }
  const { loaded, client } = await loadProject(io, values)
  const [comparison, meta] = await Promise.all([
    compareLocaleFiles(loaded, client, {
      locales: list(values.locales),
      keys: list(values.keys),
    }),
    client.meta(),
  ])
  printWarnings(io, comparison.warnings)
  const built = buildResolveRows(comparison)
  if (built.rows.length === 0) {
    const empty = { id: null, rows: 0, openedIn: null }
    io.stdout(
      values.json
        ? `${JSON.stringify(empty)}\n`
        : 'Nothing needs a decision.\n',
    )
    return 0
  }
  const now = Date.now()
  await prepareReviewDir(loaded.root, now)
  const inEditor =
    open !== 'browser' && (await hasEditor(loaded.root, 'resolve'))
  if (open === 'editor' && !inEditor) {
    throw new Error(
      'No VS Code or Cursor window with the Localness extension has this project open.',
    )
  }
  const doc: ResolveReviewDoc = {
    kind: 'resolve',
    id: randomBytes(4).toString('hex'),
    createdAt: new Date(now).toISOString(),
    project: meta.project?.name ?? String(loaded.config.project ?? ''),
    sourceLocale: comparison.sourceLocale,
    editor: editorOf(io.env),
    open: inEditor ? 'editor' : 'browser',
    config: values.config ? configField(io, loaded) : '',
    hasBase: built.hasBase,
    dirs: built.dirs,
    empties: built.empties,
    rows: built.rows,
  }
  return present(io, values, loaded.root, doc, open)
}

async function present(
  io: CliIo,
  values: CliValues,
  root: string,
  doc: ReviewDoc,
  open: string,
) {
  const files = reviewPaths(root, doc.id)
  await writeJson(files.doc, doc)
  const inEditor = doc.open === 'editor'
  let claim = inEditor
    ? await waitForClaim(
        files.claim,
        open === 'editor' ? START_WAIT_MS : CLAIM_WAIT_MS,
      )
    : null
  if (!claim && open === 'editor') {
    throw new Error('The editor did not open the review; try --open browser.')
  }
  claim ??= await serveInBrowser(io, values, doc.id, files.claim)
  if (!claim?.url && !claim?.editor) {
    throw new Error(
      claim?.error ?? 'The review page did not start; check the review file.',
    )
  }
  if (claim.url) openBrowser(claim.url)
  const openedIn = claim.url ? 'browser' : 'editor'
  const noun = doc.kind === 'resolve' ? 'key' : 'text'
  if (values.json) {
    io.stdout(
      `${JSON.stringify({ id: doc.id, url: claim.url ?? null, rows: doc.rows.length, openedIn })}\n`,
    )
  } else {
    const where = claim.url
      ? `opened in the browser:\n  ${claim.url}`
      : 'opened in your editor.'
    io.stdout(
      `Review ${doc.id}: ${plural(doc.rows.length, noun)}, ${where}\n` +
        `Run "localness review wait ${doc.id}" for the decisions.\n`,
    )
  }
  return 0
}

function serveInBrowser(
  io: CliIo,
  values: CliValues,
  id: string,
  claimPath: string,
) {
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
  return waitForClaim(claimPath, START_WAIT_MS)
}

async function runServe(io: CliIo, values: CliValues, id: string) {
  const { loaded, client } = await loadProject(io, values)
  const files = reviewPaths(loaded.root, id)
  try {
    const doc = await readJson<ReviewDoc>(files.doc)
    if (!doc) throw new Error(`No review ${id}.`)
    const review = await startReviewServer({
      doc,
      taken:
        doc.kind === 'resolve'
          ? undefined
          : takenNames(loaded, client, doc.sourceLocale),
      onDone: (result) => writeJson(files.result, result),
    })
    const close = () => {
      review.server.close()
      review.server.closeAllConnections()
    }
    // An editor picked it up first.
    if (
      !(await claimReview(files.claim, { url: review.url, pid: process.pid }))
    ) {
      close()
      return 0
    }
    const expire = setTimeout(async () => {
      await writeJson(
        files.result,
        doc.kind === 'resolve'
          ? toResolveResult(doc, 'cancelled', [])
          : toResult(doc, 'cancelled', []),
      )
      close()
    }, SERVE_TTL_MS)
    await Promise.race([
      review.done,
      new Promise((done) => review.server.once('close', done)),
    ])
    clearTimeout(expire)
    close()
    return 0
  } catch (error) {
    await claimReview(files.claim, {
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
  const files = reviewPaths((await loadConfig(config)).root, id)
  const until = Date.now() + timeout * 1000
  for (;;) {
    const result = await readJson<ReviewResult>(files.result)
    if (result) {
      io.stdout(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }
    const info = await readJson<ReviewClaim>(files.claim)
    if (!info) throw new Error(`No review ${id} here.`)
    if (!isAlive(info.pid)) {
      const shown = info.editor ? 'The editor showing' : 'The review page for'
      throw new Error(
        `${shown} ${id} stopped without an answer; start a new review.`,
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

function reviewKind(value: string | undefined): EditorKind {
  const kind = value ?? 'extract'
  if (kind !== 'extract' && kind !== 'resolve') {
    throw new Error('--kind takes extract or resolve.')
  }
  return kind
}

type EditorKind = 'extract' | 'resolve'

/** An interactive page where the person decides an extraction or a diff. */
export async function runReview(
  io: CliIo,
  values: CliValues,
  [sub, ...rest]: string[],
) {
  if (!sub) throw new Error(USAGE)
  switch (sub) {
    case 'start':
      return reviewKind(values.kind) === 'resolve'
        ? startResolve(io, values, rest)
        : startExtract(io, values, rest)
    case 'wait':
    case 'serve': {
      const [arg, ...extra] = rest
      if (!arg || extra.length > 0) throw new Error(USAGE)
      return sub === 'wait'
        ? runWait(io, values, arg)
        : runServe(io, values, arg)
    }
    default:
      throw new Error(USAGE)
  }
}

function startExtract(io: CliIo, values: CliValues, args: string[]) {
  const [file, ...extra] = args
  if (!file || extra.length > 0) throw new Error(USAGE)
  return runStart(io, values, file)
}

function startResolve(io: CliIo, values: CliValues, args: string[]) {
  if (args.length > 0) {
    throw new Error('review start --kind resolve takes no file.')
  }
  return runResolveStart(io, values)
}
