import {
  checkDecisions,
  decisionWarnings,
  toResult,
  type ReviewDecision,
  type ReviewDoc,
  type ReviewResult,
} from './model'

export interface ReviewSessionOptions {
  doc: ReviewDoc
  /** New names that already exist on the project or in the local file. */
  taken(names: string[]): Promise<Set<string>>
  /** Called once, after the page approves or cancels. */
  onDone(result: ReviewResult): Promise<void> | void
}

export interface ReviewResponse {
  status: number
  body: unknown
}

export interface ReviewSession {
  /** Answers one page request, whether it came over HTTP or a webview. */
  request(method: string, path: string, body?: unknown): Promise<ReviewResponse>
  /** Settles with what the page decided. */
  done: Promise<ReviewResult>
  readonly settled: boolean
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
  let finish!: (result: ReviewResult) => void
  const done = new Promise<ReviewResult>((resolve) => (finish = resolve))
  let settled = false

  const settle = async (result: ReviewResult) => {
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
    switch (path) {
      case '/api/check': {
        const decisions = decisionsOf(body)
        const errors = await checkDecisions(doc, decisions, options.taken)
        return {
          status: 200,
          body: { errors, warnings: decisionWarnings(doc, decisions) },
        }
      }
      case '/api/submit': {
        const decisions = decisionsOf(body)
        const errors = await checkDecisions(doc, decisions, options.taken)
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
