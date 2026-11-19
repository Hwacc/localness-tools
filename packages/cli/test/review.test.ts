import { afterEach, describe, expect, it } from 'vitest'
import {
  checkDecisions,
  decisionWarnings,
  initialDecision,
  parseReviewInput,
  type ReviewDoc,
  type ReviewResult,
} from '../src/review/model'
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

describe('review model', () => {
  it('reads the agent file and rejects rows without text', () => {
    expect(
      parseReviewInput({ items: [{ text: 'Hi', line: 3, key: 'hi' }] }),
    ).toEqual([{ text: 'Hi', file: undefined, line: 3, key: 'hi' }])
    expect(() => parseReviewInput([{ text: ' ' }])).toThrow('items[0]')
    expect(() => parseReviewInput([{ text: 'Hi', line: '3' }])).toThrow(
      'number',
    )
  })

  it('reuses a single match, asks on several, names the rest', () => {
    expect(doc().rows.map(initialDecision)).toEqual([
      { action: 'reuse', key: 'save' },
      { action: 'reuse', key: '' },
      { action: 'create', key: 'checkout_apply_coupon' },
      { action: 'create', key: 'checkout_pay' },
    ])
  })

  it('flags convention breaks, taken names and one name for two texts', async () => {
    const errors = await checkDecisions(
      doc(),
      [
        { action: 'reuse', key: 'save' },
        { action: 'reuse', key: '' },
        { action: 'create', key: 'checkout..apply' },
        { action: 'create', key: 'checkout_pay' },
      ],
      async (names) => new Set(names.filter((name) => name === 'checkout_pay')),
    )
    expect(errors[0]).toBeNull()
    expect(errors[1]).toMatch(/Pick/)
    expect(errors[2]).toBe('Has an empty segment')
    expect(errors[3]).toBe('checkout_pay already exists.')

    const [, local] = await checkDecisions(
      doc(),
      [
        { action: 'skip', key: '' },
        { action: 'reuse', key: 'dialog__ok' },
        { action: 'skip', key: '' },
        { action: 'skip', key: '' },
      ],
      none,
    )
    expect(local).toMatch(/^Push will block this local key: /)

    const shared = await checkDecisions(
      doc(),
      [
        { action: 'skip', key: '' },
        { action: 'reuse', key: 'dialog_ok' },
        { action: 'create', key: 'checkout_go' },
        { action: 'create', key: 'checkout_go' },
      ],
      none,
    )
    expect(shared).toEqual([
      null,
      null,
      'checkout_go is also used for a different text.',
      'checkout_go is also used for a different text.',
    ])
  })

  it('only warns when a new name is off the suggested style', async () => {
    const decisions = [
      { action: 'reuse', key: 'save' },
      { action: 'reuse', key: 'ok' },
      { action: 'create', key: 'checkout.ApplyCoupon' },
      { action: 'skip', key: '' },
    ] as const
    expect(await checkDecisions(doc(), [...decisions], none)).toEqual([
      null,
      null,
      null,
      null,
    ])
    expect(decisionWarnings(doc(), [...decisions])).toEqual([
      null,
      null,
      'Off the suggested key style: Uses a separator other than the configured one; Does not match the configured casing',
      null,
    ])
  })
})

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
    const written: ReviewResult[] = []
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
