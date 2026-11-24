import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  announceEditor,
  checkDecisions,
  claimReview,
  createReviewSession,
  decisionWarnings,
  hasEditor,
  initialDecision,
  parseReviewInput,
  prepareReviewDir,
  reviewPaths,
  withdrawEditor,
  type ExtractReviewDoc,
} from '../src/review'

const convention = {
  prefix: '',
  separator: '_',
  style: 'snake_case',
  maxDepth: 4,
  guidance: null,
} as const

function doc(): ExtractReviewDoc {
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

  it('serves a doc written before resolve reviews as an extract review', async () => {
    const written: unknown[] = []
    const session = createReviewSession({
      doc: doc(),
      taken: none,
      onDone: (result) => void written.push(result),
    })
    const decisions = [
      { action: 'reuse', key: 'save' },
      { action: 'reuse', key: 'ok' },
      { action: 'create', key: 'checkout_apply_coupon' },
      { action: 'skip', key: '' },
    ]
    const check = await session.request('POST', '/api/check', { decisions })
    expect(check).toMatchObject({
      status: 200,
      body: { errors: [null, null, null, null] },
    })
    expect(check.body).toHaveProperty('warnings')
    expect(
      await session.request('POST', '/api/submit', { decisions }),
    ).toMatchObject({ status: 200 })
    expect(written[0]).toMatchObject({ id: 'abcd1234', status: 'approved' })
    expect(written[0]).not.toHaveProperty('kind')
  })
})

describe('review files', () => {
  let root: string | undefined
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('lets only the first claim stand', async () => {
    root = await mkdtemp(join(tmpdir(), 'review-'))
    await prepareReviewDir(root)
    const { claim } = reviewPaths(root, 'abcd1234')
    expect(await claimReview(claim, { pid: 1, editor: 'vscode' })).toBe(true)
    expect(await claimReview(claim, { pid: 2, url: 'http://x' })).toBe(false)
    expect(JSON.parse(await readFile(claim, 'utf8'))).toEqual({
      pid: 1,
      editor: 'vscode',
    })
    expect(() => reviewPaths(root!, '../x')).toThrow('Invalid review id')
  })

  it('only counts editors that are still running', async () => {
    root = await mkdtemp(join(tmpdir(), 'review-'))
    expect(await hasEditor(root)).toBe(false)
    await announceEditor(root, 2 ** 22 + 7)
    expect(await hasEditor(root)).toBe(false)
    await announceEditor(root)
    expect(await hasEditor(root)).toBe(true)
    expect(await hasEditor(root, 'resolve')).toBe(true)
    expect(await hasEditor(root, 'plan')).toBe(true)
    await withdrawEditor(root)
    expect(await hasEditor(root)).toBe(false)
  })

  it('treats an editor that names no kinds as extract only', async () => {
    root = await mkdtemp(join(tmpdir(), 'review-'))
    await announceEditor(root)
    await writeFile(
      join(root, '.localness', 'editors', `${process.pid}.json`),
      `${JSON.stringify({ pid: process.pid })}\n`,
    )
    expect(await hasEditor(root, 'extract')).toBe(true)
    expect(await hasEditor(root, 'resolve')).toBe(false)
    expect(await hasEditor(root, 'plan')).toBe(false)
  })

  it('ignores a plan page when the editor does not list it', async () => {
    root = await mkdtemp(join(tmpdir(), 'review-'))
    await announceEditor(root)
    await writeFile(
      join(root, '.localness', 'editors', `${process.pid}.json`),
      `${JSON.stringify({ pid: process.pid, kinds: ['extract', 'resolve'] })}\n`,
    )
    expect(await hasEditor(root, 'resolve')).toBe(true)
    expect(await hasEditor(root, 'plan')).toBe(false)
  })

  it('drops review files older than a day', async () => {
    root = await mkdtemp(join(tmpdir(), 'review-'))
    await prepareReviewDir(root)
    const { doc, result } = reviewPaths(root, 'abcd1234')
    await writeFile(doc, '{}')
    await writeFile(result, '{}')
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(doc, old, old)
    await prepareReviewDir(root)
    await expect(readFile(doc)).rejects.toThrow()
    await expect(readFile(result, 'utf8')).resolves.toBe('{}')
  })
})
