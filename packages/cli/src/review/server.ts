import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  checkDecisions,
  decisionWarnings,
  toResult,
  type ReviewDecision,
  type ReviewDoc,
  type ReviewResult,
} from './model'
import { reviewPage } from './page'

const MAX_BODY = 1024 * 1024

export interface ReviewServerOptions {
  doc: ReviewDoc
  /** New names that already exist on the project or in the local file. */
  taken(names: string[]): Promise<Set<string>>
  /** Called once, after the page approves or cancels. */
  onDone(result: ReviewResult): Promise<void> | void
}

export interface RunningReview {
  server: Server
  url: string
  /** Settles with what the page decided. */
  done: Promise<ReviewResult>
}

function readBody(request: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('Request too large.'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'))
      } catch {
        reject(new Error('Invalid JSON.'))
      }
    })
    request.on('error', reject)
  })
}

function decisionsOf(body: unknown): ReviewDecision[] {
  const decisions = (body as { decisions?: unknown } | null)?.decisions
  if (!Array.isArray(decisions)) throw new Error('Expected "decisions".')
  return decisions.map((value: unknown) => {
    const decision = value as Partial<ReviewDecision> | null
    return {
      action: decision?.action ?? 'skip',
      key: typeof decision?.key === 'string' ? decision.key : '',
    } as ReviewDecision
  })
}

/**
 * Serves the review page on 127.0.0.1 at a random port. Every request must
 * carry the URL's token, so other local pages cannot read or answer it.
 */
export async function startReviewServer(
  options: ReviewServerOptions,
): Promise<RunningReview> {
  const { doc } = options
  const token = randomBytes(16).toString('hex')
  let finish!: (result: ReviewResult) => void
  const done = new Promise<ReviewResult>((resolve) => (finish = resolve))
  let settled = false

  const server = createServer(async (request, response) => {
    const send = (status: number, body: unknown, type = 'application/json') => {
      response.writeHead(status, {
        'content-type': `${type}; charset=utf-8`,
        'cache-control': 'no-store',
      })
      response.end(type === 'application/json' ? JSON.stringify(body) : body)
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const given = url.searchParams.get('t') ?? request.headers['x-review-token']
    if (given !== token) return send(403, { error: 'Wrong review token.' })
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        return send(200, reviewPage(token), 'text/html')
      }
      if (request.method === 'GET' && url.pathname === '/api/review') {
        return send(200, { ...doc, settled })
      }
      if (request.method !== 'POST') return send(404, { error: 'Not found.' })
      if (settled) return send(409, { error: 'This review is closed.' })
      const body = await readBody(request)
      switch (url.pathname) {
        case '/api/check': {
          const decisions = decisionsOf(body)
          const errors = await checkDecisions(doc, decisions, options.taken)
          return send(200, {
            errors,
            warnings: decisionWarnings(doc, decisions),
          })
        }
        case '/api/submit': {
          const decisions = decisionsOf(body)
          const errors = await checkDecisions(doc, decisions, options.taken)
          if (errors.some(Boolean)) return send(422, { errors })
          const result = toResult(doc, 'approved', decisions)
          settled = true
          await options.onDone(result)
          send(200, { ok: true })
          return finish(result)
        }
        case '/api/cancel': {
          const result = toResult(doc, 'cancelled', [])
          settled = true
          await options.onDone(result)
          send(200, { ok: true })
          return finish(result)
        }
        default:
          return send(404, { error: 'Not found.' })
      }
    } catch (error) {
      return send(400, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return { server, url: `http://127.0.0.1:${port}/?t=${token}`, done }
}
