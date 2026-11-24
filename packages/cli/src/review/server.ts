import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createReviewSession,
  reviewKindOf,
  reviewPage,
  type PlanReviewResult,
  type ResolveReviewResult,
  type ReviewResult,
  type ReviewSessionOptions,
} from '@localness/sdk/review'

const MAX_BODY = 1024 * 1024

export interface RunningReview {
  server: Server
  url: string
  /** Settles with what the page decided. */
  done: Promise<ReviewResult | ResolveReviewResult | PlanReviewResult>
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

/**
 * Serves the review page on 127.0.0.1 at a random port. Every request must
 * carry the URL's token, so other local pages cannot read or answer it.
 */
export async function startReviewServer(
  options: ReviewSessionOptions,
): Promise<RunningReview> {
  const token = randomBytes(16).toString('hex')
  const session = createReviewSession(options)

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
    if (request.method === 'GET' && url.pathname === '/') {
      return send(
        200,
        reviewPage({
          host: 'browser',
          token,
          kind: reviewKindOf(options.doc),
        }),
        'text/html',
      )
    }
    let body: unknown
    try {
      body = request.method === 'POST' ? await readBody(request) : undefined
    } catch (error) {
      return send(400, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    const answer = await session.request(
      request.method ?? 'GET',
      url.pathname,
      body,
    )
    return send(answer.status, answer.body)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    server,
    url: `http://127.0.0.1:${port}/?t=${token}`,
    done: session.done,
  }
}
