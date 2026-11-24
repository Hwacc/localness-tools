import {
  checkDecisions,
  decisionWarnings,
  toResult,
  type ReviewDecision,
  type ReviewDoc,
  type ReviewResult,
} from './model'
import {
  checkResolveDecisions,
  toResolveResult,
  type ResolveDecision,
  type ResolveReviewDoc,
  type ResolveReviewResult,
} from './resolve'

export interface ReviewSessionOptions {
  doc: ReviewDoc
  /** New names that already exist on the project or in the local file. Extract only. */
  taken?(names: string[]): Promise<Set<string>>
  /** Called once, after the page approves or cancels. */
  onDone(result: ReviewResult | ResolveReviewResult): Promise<void> | void
}

export interface ReviewResponse {
  status: number
  body: unknown
}

export interface ReviewSession {
  /** Answers one page request, whether it came over HTTP or a webview. */
  request(method: string, path: string, body?: unknown): Promise<ReviewResponse>
  /** Settles with what the page decided. */
  done: Promise<ReviewResult | ResolveReviewResult>
  readonly settled: boolean
}

function resolveDecisionsOf(
  body: unknown,
  doc: ResolveReviewDoc,
): ResolveDecision[][] {
  const decisions = (body as { decisions?: unknown } | null)?.decisions
  if (!Array.isArray(decisions)) throw new Error('Expected "decisions".')
  if (decisions.length !== doc.rows.length) {
    throw new Error('Expected one decision per row.')
  }
  return decisions.map((row: unknown, index) => {
    if (!Array.isArray(row) || row.length !== doc.rows[index]!.cells.length) {
      throw new Error(
        `Expected one decision per locale of ${doc.rows[index]!.key}.`,
      )
    }
    return row.map((value: unknown) => {
      const decision = value as Partial<ResolveDecision> | null
      return {
        action: decision?.action ?? 'skip',
        into: typeof decision?.into === 'string' ? decision.into : undefined,
      }
    })
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

export function createReviewSession(
  options: ReviewSessionOptions,
): ReviewSession {
  const { doc } = options
  let finish!: (result: ReviewResult | ResolveReviewResult) => void
  const done = new Promise<ReviewResult | ResolveReviewResult>(
    (resolve) => (finish = resolve),
  )
  let settled = false

  const settle = async (result: ReviewResult | ResolveReviewResult) => {
    settled = true
    await options.onDone(result)
    finish(result)
    return { status: 200, body: { ok: true } }
  }

  const answer = async (
    method: string,
    path: string,
    body: unknown,
  ): Promise<ReviewResponse> => {
    if (method === 'GET' && path === '/api/review') {
      return { status: 200, body: { ...doc, settled } }
    }
    if (method !== 'POST') return { status: 404, body: { error: 'Not found.' } }
    if (settled)
      return { status: 409, body: { error: 'This review is closed.' } }
    if (doc.kind === 'resolve') {
      switch (path) {
        case '/api/check':
          return {
            status: 200,
            body: {
              errors: checkResolveDecisions(doc, resolveDecisionsOf(body, doc)),
            },
          }
        case '/api/submit': {
          const decisions = resolveDecisionsOf(body, doc)
          const errors = checkResolveDecisions(doc, decisions)
          if (errors.some((row) => row.some(Boolean))) {
            return { status: 422, body: { errors } }
          }
          return settle(toResolveResult(doc, 'approved', decisions))
        }
        case '/api/cancel':
          return settle(toResolveResult(doc, 'cancelled', []))
        default:
          return { status: 404, body: { error: 'Not found.' } }
      }
    }
    if (!options.taken) {
      throw new Error('Extract review needs a taken check.')
    }
    const taken = options.taken
    switch (path) {
      case '/api/check': {
        const decisions = decisionsOf(body)
        const errors = await checkDecisions(doc, decisions, taken)
        return {
          status: 200,
          body: { errors, warnings: decisionWarnings(doc, decisions) },
        }
      }
      case '/api/submit': {
        const decisions = decisionsOf(body)
        const errors = await checkDecisions(doc, decisions, taken)
        if (errors.some(Boolean)) return { status: 422, body: { errors } }
        return settle(toResult(doc, 'approved', decisions))
      }
      case '/api/cancel':
        return settle(toResult(doc, 'cancelled', []))
      default:
        return { status: 404, body: { error: 'Not found.' } }
    }
  }

  return {
    async request(method, path, body) {
      try {
        return await answer(method, path, body)
      } catch (error) {
        return {
          status: 400,
          body: {
            error: error instanceof Error ? error.message : String(error),
          },
        }
      }
    },
    done,
    get settled() {
      return settled
    },
  }
}
