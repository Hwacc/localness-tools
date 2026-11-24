import { afterEach, describe, expect, it } from 'vitest'
import type {
  PlanReviewResult,
  ResolveReviewResult,
  ReviewDoc,
  ReviewResult,
} from '@localness/sdk/review'
import { startReviewServer, type RunningReview } from '../src/review/server'

const convention = {
  prefix: '',
  separator: '_',
  style: 'snake_case',
  maxDepth: 4,
  guidance: null,
} as const

function doc(): ReviewDoc {
  return {
    id: 'abcd1234',
    createdAt: 'now',
    project: 'Web',
    sourceLocale: 'en',
    editor: 'vscode',
    convention,
    namespaces: [],
    rows: [
      {
        index: 1,
        text: 'Save',
        candidates: [{ key: 'save', sourceText: 'Save', source: 'platform' }],
        suggestion: '',
      },
      {
        index: 2,
        text: 'OK',
        candidates: [
          { key: 'ok', sourceText: 'OK', source: 'platform' },
          { key: 'dialog_ok', sourceText: 'OK', source: 'local' },
          { key: 'dialog__ok', sourceText: 'OK', source: 'local' },
        ],
        suggestion: '',
      },
      {
        index: 3,
        text: 'Apply coupon',
        candidates: [],
        suggestion: 'checkout_apply_coupon',
      },
      { index: 4, text: 'Pay now', candidates: [], suggestion: 'checkout_pay' },
    ],
  }
}

const none = async () => new Set<string>()

describe('review server', () => {
  let review: RunningReview | undefined
  afterEach(() => {
    review?.server.close()
    review?.server.closeAllConnections()
  })

  async function post(
    path: string,
    body: unknown,
    token = new URL(review!.url).searchParams.get('t')!,
  ) {
    const response = await fetch(new URL(path, review!.url), {
      method: 'POST',
      headers: { 'x-review-token': token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    }
  }

  it('needs the token, re-checks on submit and reports the decisions', async () => {
    const written: (ReviewResult | ResolveReviewResult | PlanReviewResult)[] =
      []
    review = await startReviewServer({
      doc: doc(),
      taken: none,
      onDone: (result) => void written.push(result),
    })

    expect((await fetch(new URL('/api/review', review.url))).status).toBe(403)
    expect((await post('/api/check', { decisions: [] }, 'wrong')).status).toBe(
      403,
    )
    expect((await fetch(review.url)).status).toBe(200)

    const bad = await post('/api/submit', {
      decisions: [
        { action: 'reuse', key: 'save' },
        { action: 'reuse', key: '' },
        { action: 'create', key: 'checkout_apply_coupon' },
        { action: 'skip', key: '' },
      ],
    })
    expect(bad.status).toBe(422)
    expect(written).toEqual([])

    const ok = await post('/api/submit', {
      decisions: [
        { action: 'reuse', key: 'save' },
        { action: 'reuse', key: 'dialog_ok' },
        { action: 'create', key: ' checkout_apply_coupon ' },
        { action: 'skip', key: 'ignored' },
      ],
    })
    expect(ok.status).toBe(200)
    const expected: ReviewResult = {
      id: 'abcd1234',
      status: 'approved',
      items: [
        {
          index: 1,
          text: 'Save',
          file: undefined,
          line: undefined,
          action: 'reuse',
          key: 'save',
          source: 'platform',
        },
        {
          index: 2,
          text: 'OK',
          file: undefined,
          line: undefined,
          action: 'reuse',
          key: 'dialog_ok',
          source: 'local',
        },
        {
          index: 3,
          text: 'Apply coupon',
          file: undefined,
          line: undefined,
          action: 'create',
          key: 'checkout_apply_coupon',
        },
        {
          index: 4,
          text: 'Pay now',
          file: undefined,
          line: undefined,
          action: 'skip',
        },
      ],
    }
    expect(written).toEqual([expected])
    expect(await review.done).toEqual(expected)
    expect((await post('/api/cancel', {})).status).toBe(409)
  })
})
