import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONFIG_FILE_NAME,
  listPlans,
  loadConfig,
  loadPlan,
  savePlan,
  type PushPlan,
} from '../src/sync'
import {
  buildPlanSection,
  checkPlanDecisions,
  narrowPlan,
  settlePlans,
  type PlanDecision,
  type PlanReviewDoc,
} from '../src/review/plan'
import { createReviewSession } from '../src/review/session'
import { BASE_URL } from './helpers'

function plan(patch: Partial<PushPlan> = {}): PushPlan {
  return {
    version: 1,
    id: 'aaaa1111',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T01:00:00.000Z',
    baseUrl: BASE_URL,
    project: null,
    content: 'published',
    sourceLocale: 'en',
    release: { id: 3, name: 'v2' },
    keys: [
      {
        key: 'title',
        create: null,
        locales: {
          en: { text: 'Title', platform: 'Old', draft: null },
          ja: { text: '題名', platform: '旧', draft: '下書き' },
        },
      },
      {
        key: 'fresh',
        create: { sourceText: 'New' },
        locales: { ja: { text: '新しい', platform: null, draft: null } },
      },
    ],
    blocked: [{ locale: 'ja', key: 'dup', reason: 'duplicate' }],
    warnings: [{ key: 'fresh', violations: ['case'] }],
    ...patch,
  }
}

function decide(
  approve: boolean,
  keys: Array<{ include: boolean; locales: boolean[] }>,
): PlanDecision {
  return { approve, keys }
}

const all: PlanDecision = decide(true, [
  { include: true, locales: [true, true] },
  { include: true, locales: [true] },
])

describe('narrowPlan', () => {
  it('returns the same plan when every key and locale stays', () => {
    const saved = plan()
    expect(narrowPlan(saved, all)).toBe(saved)
  })

  it('drops a locale, a whole key, and the warning of a dropped key', () => {
    const saved = plan()
    const narrowed = narrowPlan(
      saved,
      decide(true, [
        { include: true, locales: [true, false] },
        { include: false, locales: [false] },
      ]),
    )
    expect(narrowed).not.toBe(saved)
    expect(narrowed?.id).toBe(saved.id)
    expect(narrowed?.expiresAt).toBe(saved.expiresAt)
    expect(narrowed?.keys).toEqual([
      {
        key: 'title',
        create: null,
        locales: { en: { text: 'Title', platform: 'Old', draft: null } },
      },
    ])
    expect(narrowed?.warnings).toEqual([])
  })

  it('keeps a new key that lost every locale, and drops an update that did', () => {
    const saved = plan()
    const onlyCreate = narrowPlan(
      saved,
      decide(true, [
        { include: false, locales: [false, false] },
        { include: true, locales: [false] },
      ]),
    )
    expect(onlyCreate?.keys).toEqual([
      { key: 'fresh', create: { sourceText: 'New' }, locales: {} },
    ])
    expect(onlyCreate?.warnings).toEqual(saved.warnings)
    expect(
      narrowPlan(
        saved,
        decide(true, [
          { include: true, locales: [false, false] },
          { include: false, locales: [false] },
        ]),
      ),
    ).toBeNull()
  })

  it('returns null when the plan is rejected', () => {
    expect(narrowPlan(plan(), decide(false, all.keys))).toBeNull()
  })
})

describe('buildPlanSection', () => {
  it('shows the remote draft as the text being replaced and names stale keys', () => {
    const section = buildPlanSection(plan(), { stale: ['title'] })
    expect(section.release).toBe('v2')
    expect(section.keys[0]).toMatchObject({
      index: 1,
      key: 'title',
      stale: true,
      locales: [
        { locale: 'en', from: 'Old' },
        { locale: 'ja', from: '下書き', platform: '旧', draft: '下書き' },
      ],
    })
    expect(section.keys[1]?.warning).toMatch(/casing|case/i)
    expect(section.blocked[0]?.text).toMatch(/several directories/)
    expect(section.stale).toEqual(['title'])
  })
})

describe('checkPlanDecisions', () => {
  const doc = { plans: [buildPlanSection(plan(), { stale: [] })] }

  it('rejects a review where nothing was kept', () => {
    expect(checkPlanDecisions(doc, [decide(false, all.keys)])).toEqual([
      'Nothing selected; cancel instead.',
    ])
    expect(
      checkPlanDecisions(doc, [
        decide(true, [
          { include: true, locales: [false, false] },
          { include: false, locales: [false] },
        ]),
      ]),
    ).toEqual(['Nothing selected; cancel instead.'])
  })

  it('accepts a new key kept with no locales', () => {
    expect(
      checkPlanDecisions(doc, [
        decide(true, [
          { include: false, locales: [false, false] },
          { include: true, locales: [false] },
        ]),
      ]),
    ).toEqual([null])
  })
})

describe('settlePlans', () => {
  let root: string
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('deletes a rejected plan, replaces a narrowed one, and keeps one left whole', async () => {
    root = await mkdtemp(join(tmpdir(), 'plan-review-'))
    await mkdir(join(root, 'locales'), { recursive: true })
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    const loaded = await loadConfig(join(root, CONFIG_FILE_NAME))
    const kept = plan({ id: 'bbbb2222' })
    const narrowed = plan({ id: 'cccc3333' })
    const rejected = plan({ id: 'dddd4444' })
    await savePlan(loaded, kept)
    await savePlan(loaded, narrowed)
    await savePlan(loaded, rejected)
    const doc: PlanReviewDoc = {
      kind: 'plan',
      id: 'eeee5555',
      createdAt: 'now',
      project: 'Web',
      sourceLocale: 'en',
      editor: 'vscode',
      config: 'app/localness.config.json',
      plans: [kept, narrowed, rejected].map((item) =>
        buildPlanSection(item, { stale: [] }),
      ),
    }
    const result = await settlePlans(loaded, doc, [
      all,
      decide(true, [
        { include: true, locales: [false, true] },
        { include: true, locales: [true] },
      ]),
      decide(false, all.keys),
    ])
    expect(await loadPlan(loaded, 'bbbb2222')).toMatchObject({ id: 'bbbb2222' })
    await expect(loadPlan(loaded, 'cccc3333')).rejects.toThrow(/No plan/)
    await expect(loadPlan(loaded, 'dddd4444')).rejects.toThrow(/No plan/)
    const saved = (await listPlans(loaded)).find((item) => item.id !== 'bbbb2222')
    expect(saved?.keys[0]?.locales).toEqual({
      ja: { text: '題名', platform: '旧', draft: '下書き' },
    })
    expect(saved?.expiresAt).toBe(narrowed.expiresAt)
    expect(result.plans).toEqual([
      { planId: 'bbbb2222', applyId: 'bbbb2222', keys: 2, left: [] },
      {
        planId: 'cccc3333',
        applyId: saved?.id,
        keys: 2,
        left: [{ key: 'title', locales: ['en'] }],
      },
      {
        planId: 'dddd4444',
        applyId: null,
        keys: 0,
        left: [
          { key: 'title', locales: ['en', 'ja'] },
          { key: 'fresh', locales: ['ja'] },
        ],
      },
    ])
    expect(result.commands).toEqual([
      'localness apply bbbb2222 --config app/localness.config.json --json',
      `localness apply ${saved?.id} --config app/localness.config.json --json`,
    ])
  })

  it('touches no plan when one of them is gone, and the session stays open', async () => {
    root = await mkdtemp(join(tmpdir(), 'plan-review-'))
    await mkdir(join(root, 'locales'), { recursive: true })
    await writeFile(
      join(root, CONFIG_FILE_NAME),
      JSON.stringify({ baseUrl: BASE_URL, files: { dir: 'locales' } }),
    )
    const loaded = await loadConfig(join(root, CONFIG_FILE_NAME))
    const present = plan({ id: 'bbbb2222' })
    const gone = plan({ id: 'cccc3333' })
    await savePlan(loaded, present)
    const doc: PlanReviewDoc = {
      kind: 'plan',
      id: 'eeee5555',
      createdAt: 'now',
      project: 'Web',
      sourceLocale: 'en',
      editor: 'vscode',
      config: '',
      plans: [present, gone].map((item) =>
        buildPlanSection(item, { stale: [] }),
      ),
    }
    const narrowing = decide(true, [
      { include: true, locales: [false, true] },
      { include: true, locales: [true] },
    ])
    await expect(
      settlePlans(loaded, doc, [narrowing, all]),
    ).rejects.toThrow(/No plan cccc3333/)
    expect(await listPlans(loaded)).toEqual([present])

    const session = createReviewSession({ doc, loaded, onDone: () => {} })
    const answer = await session.request('POST', '/api/submit', {
      decisions: [narrowing, all],
    })
    expect(answer.status).toBe(409)
    expect(answer.body).toMatchObject({ error: expect.stringMatching(/No plan/) })
    expect(session.settled).toBe(false)
    expect(await listPlans(loaded)).toEqual([present])
  })
})
