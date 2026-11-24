import { html, nothing, render as renderHtml } from 'lit-html'
import { repeat } from 'lit-html/directives/repeat.js'
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js'
import type {
  PlanDecision,
  PlanKeyRow,
  PlanLocaleChange,
  PlanReviewDoc,
  PlanSection,
} from '../../plan-doc'
import { apiError, pageHost, reviewRoot } from './host'
import { localeFlag, localeName } from './locale'

const host = pageHost()
const root = reviewRoot()

interface CheckBody {
  errors?: (string | null)[]
}

let doc: PlanReviewDoc | null = null
let decisions: PlanDecision[] = []
let errors: (string | null)[] = []
const openRows = new Set<string>()
let pending = false
let approveHeld = false
let seq = 0
let metaOverride: string | null = null
let done: { title: string; text: string } | null = null

function render() {
  renderHtml(view(), root)
}

function rowId(plan: number, key: number) {
  return `${plan}:${key}`
}

function fresh(loaded: PlanReviewDoc): PlanDecision[] {
  return loaded.plans.map((plan) => ({
    approve: true,
    keys: plan.keys.map((key) => ({
      include: true,
      locales: key.locales.map(() => true),
    })),
  }))
}

function selectedCounts() {
  let keys = 0
  let created = 0
  let rejected = 0
  for (const [index, plan] of decisions.entries()) {
    if (!plan.approve) {
      rejected += 1
      continue
    }
    const section = doc?.plans[index]
    for (const [keyIndex, key] of plan.keys.entries()) {
      const row = section?.keys[keyIndex]
      const kept = key.include && (row?.create || key.locales.some(Boolean))
      if (!kept) continue
      keys += 1
      if (row?.create) created += 1
    }
  }
  return { keys, created, rejected }
}

function expiresIn(iso: string) {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000)
  if (!Number.isFinite(minutes) || minutes <= 0) return 'expired'
  if (minutes < 60) return `expires in ${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours === 1 ? 'expires in 1 hour' : `expires in ${hours} hours`
}

function localeChip(locale: string) {
  const flag = localeFlag(locale)
  return html`<span class="chip" title=${locale}>
    ${flag ? html`<span class="flag">${unsafeSVG(flag)}</span>` : nothing}
    <span>${localeName(locale)}</span>
  </span>`
}

function previewValue(text: string | null) {
  const value = text === null ? '(none)' : text
  return html`<span class="value" title=${text ?? ''}>${value}</span>`
}

function side(label: string, text: string | null, mark: boolean) {
  const value = text === null ? '(none)' : text
  // The box keeps whitespace, so the value cannot sit on its own line.
  // prettier-ignore
  return html`<div class="box ${mark ? 'changed' : ''}"><span class="label">${label}</span>${value}</div>`
}

function meta() {
  if (metaOverride !== null) return metaOverride
  if (!doc) return 'Loading…'
  const where = doc.config ? ` · ${doc.config}` : ''
  return `${doc.project} · source locale ${doc.sourceLocale}${where}`
}

function payload() {
  return decisions.map((plan) => ({
    approve: plan.approve,
    keys: plan.keys.map((key) => ({
      include: key.include,
      locales: [...key.locales],
    })),
  }))
}

function setKey(planIndex: number, keyIndex: number, include: boolean) {
  const key = decisions[planIndex]?.keys[keyIndex]
  if (!key) return
  key.include = include
  key.locales = key.locales.map(() => include)
}

function setLocale(
  planIndex: number,
  keyIndex: number,
  localeIndex: number,
  include: boolean,
) {
  const key = decisions[planIndex]?.keys[keyIndex]
  const row = doc?.plans[planIndex]?.keys[keyIndex]
  if (!key || !row) return
  key.locales[localeIndex] = include
  if (include) key.include = true
  else if (!row.create && !key.locales.some(Boolean)) key.include = false
}

function selectAll() {
  if (!doc) return
  decisions = fresh(doc)
}

function clearAll() {
  for (const plan of decisions) {
    plan.approve = false
    for (const key of plan.keys) {
      key.include = false
      key.locales = key.locales.map(() => false)
    }
  }
}

function toggle(planIndex: number, keyIndex: number) {
  const id = rowId(planIndex, keyIndex)
  if (openRows.has(id)) openRows.delete(id)
  else openRows.add(id)
}

function previewLine(change: PlanLocaleChange) {
  return html`<div class="preview-line">
    <span class="who">${localeChip(change.locale)}</span>
    <span class="mini">
      <span class="label">Remote</span>
      ${previewValue(change.from)}
    </span>
    <span class="mini changed">
      <span class="label">Locale file</span>
      ${previewValue(change.text)}
    </span>
  </div>`
}

function localeDetail(
  change: PlanLocaleChange,
  planIndex: number,
  keyIndex: number,
  localeIndex: number,
) {
  const chosen = decisions[planIndex]?.keys[keyIndex]
  const showPublished =
    change.draft !== null && change.draft !== change.platform
  return html`<div class="locale">
    <label class="who">
      <input
        type="checkbox"
        .checked=${Boolean(chosen?.locales[localeIndex])}
        @change=${(event: Event) => {
          setLocale(
            planIndex,
            keyIndex,
            localeIndex,
            (event.target as HTMLInputElement).checked,
          )
          render()
          void check()
        }}
      />
      ${localeChip(change.locale)}
    </label>
    <div class="pair">
      ${side('Remote', change.from, false)}
      ${side('Locale file (draft)', change.text, true)}
    </div>
    ${
      showPublished
        ? html`<div class="hint">
            Published: ${change.platform ?? '(none)'}
          </div>`
        : nothing
    }
  </div>`
}

function keyView(row: PlanKeyRow, planIndex: number, keyIndex: number) {
  const chosen = decisions[planIndex]?.keys[keyIndex]
  const open = openRows.has(rowId(planIndex, keyIndex))
  return html`<div class="key-row ${row.stale ? 'stale' : ''}">
    <input
      type="checkbox"
      .checked=${Boolean(chosen?.include)}
      @change=${(event: Event) => {
        setKey(planIndex, keyIndex, (event.target as HTMLInputElement).checked)
        render()
        void check()
      }}
    />
    <div class="key-main">
      <div class="who">
        <span class="text">${row.key}</span>
        <span class="badge">${row.create ? 'create' : 'update'}</span>
        ${row.stale ? html`<span class="badge">changed since the plan</span>` : nothing}
      </div>
      ${row.locales.map((change) => previewLine(change))}
      ${
        row.warning
          ? html`<div class="status warn">
              Created, but off the suggested key style: ${row.warning}
            </div>`
          : nothing
      }
      ${
        open
          ? html`<div class="detail">
              ${
                row.create
                  ? html`<div class="locale">
                      <div class="hint">
                        Source text, published. Removing the key drops this too.
                      </div>
                      ${side('Source text', row.create.sourceText, true)}
                    </div>`
                  : nothing
              }
              ${row.locales.map((change, localeIndex) =>
                localeDetail(change, planIndex, keyIndex, localeIndex),
              )}
            </div>`
          : nothing
      }
    </div>
    <button type="button" @click=${() => { toggle(planIndex, keyIndex); render() }}>
      ${open ? 'Hide' : 'Per locale'} (${row.locales.length})
    </button>
  </div>`
}

function planView(section: PlanSection, planIndex: number) {
  const decision = decisions[planIndex]
  const created = section.keys.filter((key) => key.create).length
  const release = section.release ? `, labelled ${section.release}` : ''
  const createdText =
    created > 0 ? ` (${created} new${release})` : ''
  return html`<section class="plan ${decision?.approve ? '' : 'reject'}">
    <div class="plan-head">
      <h2>
        Plan ${section.id} · ${section.keys.length} keys${createdText} ·
        ${expiresIn(section.expiresAt)}
      </h2>
      <div class="seg">
        <button
          type="button"
          aria-pressed=${String(decision?.approve === true)}
          @click=${() => {
            if (decision) decision.approve = true
            render()
            void check()
          }}
        >
          Approve
        </button>
        <button
          type="button"
          aria-pressed=${String(decision?.approve === false)}
          @click=${() => {
            if (decision) decision.approve = false
            render()
            void check()
          }}
        >
          Reject
        </button>
      </div>
    </div>
    ${
      section.stale.length
        ? html`<div class="note">
            Remote changed ${section.stale.join(', ')} after this plan was made.
            apply will refuse the whole plan; run push again.
          </div>`
        : nothing
    }
    ${
      errors[planIndex]
        ? html`<div class="status bad">${errors[planIndex]}</div>`
        : nothing
    }
    ${section.keys.map((key, keyIndex) => keyView(key, planIndex, keyIndex))}
    ${
      section.blocked.length
        ? html`<div class="hint">
            Not written:
            ${section.blocked.map(
              (item) => html`<div>${item.key} (${item.locale}): ${item.text}</div>`,
            )}
          </div>`
        : nothing
    }
  </section>`
}

function toolbar() {
  const counts = selectedCounts()
  const problem = errors.some(Boolean)
  return html`<div class="bar">
    <span class="counts">
      <span>${counts.keys} selected</span>
      <span>${counts.created} new</span>
      <span>${counts.rejected} rejected</span>
    </span>
    <span class="spacer"></span>
    <button type="button" @click=${() => { selectAll(); render(); void check() }}>
      Select all
    </button>
    <button type="button" @click=${() => { clearAll(); render(); void check() }}>
      Clear all
    </button>
    <button type="button" @click=${cancel}>Cancel</button>
    <button
      type="button"
      class="primary"
      ?disabled=${approveHeld || !doc || pending || problem || counts.keys === 0}
      @click=${approve}
    >
      Approve
    </button>
  </div>`
}

function view() {
  return html`<header>
      <h1>Approve push plans</h1>
      <div class="meta">${meta()}</div>
      ${done ? nothing : toolbar()}
    </header>
    <main>${mainView()}</main>`
}

function mainView() {
  if (done) {
    return html`<div class="done">
      <h2>${done.title}</h2>
      <p class="hint">${done.text}</p>
    </div>`
  }
  if (!doc) return nothing
  return repeat(doc.plans, (plan) => plan.id, (plan, index) => planView(plan, index))
}

async function check() {
  pending = true
  const mine = ++seq
  const { status, body } = await host.api('/api/check', { decisions: payload() })
  if (mine !== seq) return
  pending = false
  if (status !== 200) {
    host.alert(apiError(body))
    return
  }
  errors = (body as CheckBody).errors ?? []
  render()
}

async function cancel() {
  const confirmed = await host.confirm(
    'Cancel? The plans stay as they are and nothing is written to remote.',
  )
  if (!confirmed) return
  await host.api('/api/cancel', {})
  done = {
    title: 'Approval cancelled',
    text: `You can close this ${host.place} and return to your agent.`,
  }
  render()
}

async function approve() {
  approveHeld = true
  render()
  const { status, body } = await host.api('/api/submit', { decisions: payload() })
  if (status === 200) {
    done = {
      title: 'Approved',
      text: `Your agent will apply the plans from this page. You can close this ${host.place}.`,
    }
    render()
    return
  }
  const failed = body as CheckBody
  if (failed.errors) {
    errors = failed.errors
    approveHeld = false
    render()
    return
  }
  approveHeld = false
  render()
  host.alert(apiError(body))
}

async function boot() {
  render()
  const { status, body } = await host.api('/api/review')
  if (status !== 200) {
    metaOverride = apiError(body)
    render()
    return
  }
  const loaded = body as PlanReviewDoc & { settled?: boolean }
  if (loaded.settled) {
    metaOverride = ''
    done = { title: 'This review is closed', text: 'Return to your agent.' }
    render()
    return
  }
  doc = loaded
  decisions = fresh(loaded)
  errors = loaded.plans.map(() => null)
  render()
  void check()
}

void boot()
