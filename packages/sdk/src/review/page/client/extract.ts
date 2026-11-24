import { html, nothing, render as renderHtml } from 'lit-html'
import { live } from 'lit-html/directives/live.js'
import { repeat } from 'lit-html/directives/repeat.js'
import type {
  ExtractReviewDoc,
  ReviewAction,
  ReviewDecision,
  ReviewRow,
} from '../../model'
import { apiError, pageHost, reviewRoot } from './host'

const host = pageHost()
const root = reviewRoot()

const ACTIONS = [
  ['reuse', 'Reuse'],
  ['create', 'New key'],
  ['skip', 'Skip'],
] as const satisfies ReadonlyArray<readonly [ReviewAction, string]>

interface Choice extends ReviewDecision {
  /** The name typed for a new key, restored when the row returns to create. */
  created?: string
}

interface CheckBody {
  errors?: (string | null)[]
  warnings?: (string | null)[]
}

let doc: ExtractReviewDoc | null = null
let decisions: Choice[] = []
let errors: (string | null)[] = []
let warnings: (string | null)[] = []
let onlyProblems = false
let pending = false
let approveHeld = false
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
let metaOverride: string | null = null
let done: { title: string; text: string } | null = null

function initial(row: ReviewRow): Choice {
  const only = row.candidates[0]
  if (row.candidates.length === 1 && only) {
    return { action: 'reuse', key: only.key }
  }
  if (row.candidates.length > 1) return { action: 'reuse', key: '' }
  return { action: 'create', key: row.suggestion }
}

function conventionText(convention: ExtractReviewDoc['convention']) {
  if (!convention) return 'no key convention'
  const style = convention.style === 'none' ? 'any casing' : convention.style
  const parts = [
    `suggested: ${style}`,
    `separator "${convention.separator}"`,
    `max depth ${convention.maxDepth}`,
  ]
  if (convention.prefix) parts.unshift(`prefix "${convention.prefix}"`)
  return parts.join(', ')
}

function count(action: ReviewAction) {
  return decisions.filter((decision) => decision.action === action).length
}

function problemCount(list: readonly (string | null | undefined)[]) {
  return list.filter(Boolean).length
}

function render() {
  renderHtml(view(), root)
}

function meta() {
  if (metaOverride !== null) return metaOverride
  if (!doc) return 'Loading…'
  const namespaces = doc.namespaces.length
    ? ` · namespaces: ${doc.namespaces.join(', ')}`
    : ''
  return html`${doc.project} · source locale ${doc.sourceLocale} ·
    <code>${conventionText(doc.convention)}</code>${namespaces}`
}

function fileLink(row: ReviewRow) {
  if (!doc || !row.file) return nothing
  const label = row.line ? `${row.file}:${row.line}` : row.file
  if (!row.path) return html`<span>${label}</span>`
  const open = host.open
  if (open) {
    return html`<a
      href="#"
      title="Open beside"
      @click=${(event: Event) => {
        event.preventDefault()
        open(row)
      }}
      >${label}</a
    >`
  }
  const path = row.path.replace(/\\/g, '/')
  const href = `${doc.editor}://file/${path.startsWith('/') ? '' : '/'}${encodeURI(path)}${row.line ? `:${row.line}` : ''}`
  return html`<a href=${href} title="Open in editor">${label}</a>`
}

function matchBadge(row: ReviewRow) {
  const matches = row.candidates.length
  if (!matches) return nothing
  const label = matches === 1 ? '1 match' : `${matches} matches`
  return html`<span class="badge">${label}</span>`
}

function pick(row: ReviewRow, decision: Choice, action: ReviewAction) {
  if (decision.action === action) return
  decision.action = action
  if (action === 'reuse') {
    const only = row.candidates[0]
    decision.key = row.candidates.length === 1 && only ? only.key : ''
  }
  if (action === 'create') decision.key = decision.created ?? row.suggestion
  render()
  void check()
}

function segment(row: ReviewRow, decision: Choice) {
  return html`<div class="seg">
    ${ACTIONS.map(
      ([action, label]) =>
        html`<button
          type="button"
          aria-pressed=${String(decision.action === action)}
          ?disabled=${action === 'reuse' && row.candidates.length === 0}
          @click=${() => pick(row, decision, action)}
        >
          ${label}
        </button>`,
    )}
  </div>`
}

function keyField(row: ReviewRow, decision: Choice, mark: string) {
  if (decision.action === 'reuse') {
    return html`<select
      class=${mark}
      @change=${(event: Event) => {
        decision.key = (event.target as HTMLSelectElement).value
        void check()
      }}
    >
      ${
        row.candidates.length > 1
          ? html`<option
              value=""
              ?selected=${decision.key === ''}
              .textContent=${'Pick a key…'}
            ></option>`
          : nothing
      }
      ${row.candidates.map((candidate) => {
        const tag =
          candidate.source === 'local'
            ? ' (local, not pushed)'
            : candidate.draft
              ? ' (draft)'
              : ''
        return html`<option
          value=${candidate.key}
          ?selected=${candidate.key === decision.key}
          .textContent=${candidate.key + tag}
        ></option>`
      })}
    </select>`
  }
  if (decision.action === 'create') {
    return html`<input
      type="text"
      class=${mark}
      placeholder="new key name"
      spellcheck="false"
      .value=${live(decision.key)}
      @input=${(event: Event) => {
        const value = (event.target as HTMLInputElement).value
        decision.key = decision.created = value
        schedule()
      }}
    />`
  }
  return nothing
}

function statusView(
  decision: Choice,
  error: string | null | undefined,
  warning: string | null | undefined,
) {
  if (decision.action === 'skip') {
    return html`<div class="status hint">Left as is in the code.</div>`
  }
  const mark = error ? 'bad' : warning ? 'warn' : ''
  const text = error ?? warning ?? (pending ? '' : '✓')
  return html`<div class="status ${mark || 'ok'}">${text}</div>`
}

function rowView(row: ReviewRow, index: number, decision: Choice) {
  const error = errors[index]
  const warning = warnings[index]
  const mark = error ? 'bad' : warning ? 'warn' : ''
  return html`<tr class=${decision.action === 'skip' ? 'skip' : ''}>
    <td class="num">${row.index}</td>
    <td>
      <div class="text">${row.text}</div>
      <div class="where">
        ${fileLink(row)}
        ${
          row.snippet
            ? html`<code class="snippet">${row.snippet}</code>`
            : nothing
        }
      </div>
    </td>
    <td>${segment(row, decision)} ${matchBadge(row)}</td>
    <td>
      ${keyField(row, decision, mark)}${statusView(decision, error, warning)}
    </td>
  </tr>`
}

function visibleRows() {
  if (!doc) return []
  return doc.rows.flatMap((row, index) => {
    const decision = decisions[index]
    if (!decision) return []
    const needsPick = decision.action === 'reuse' && row.candidates.length > 1
    if (onlyProblems && !errors[index] && !warnings[index] && !needsPick) {
      return []
    }
    return [{ row, index, decision }]
  })
}

function table() {
  return html`<table>
    <thead>
      <tr>
        <th>#</th>
        <th>Text</th>
        <th>Action</th>
        <th>Key</th>
      </tr>
    </thead>
    <tbody>
      ${repeat(
        visibleRows(),
        (item) => item.row.index,
        (item) => rowView(item.row, item.index, item.decision),
      )}
    </tbody>
  </table>`
}

function toolbar() {
  const bad = problemCount(errors)
  const off = problemCount(warnings)
  return html`<div class="bar">
    <span class="counts">
      <span>${count('reuse')} reuse</span>
      <span>${count('create')} new</span>
      <span>${count('skip')} skip</span>
      <span class="bad-text">${bad ? `${bad} to fix` : ''}</span>
      <span class="warn-text"
        >${off ? `${off} off the suggested style` : ''}</span
      >
    </span>
    <span class="spacer"></span>
    <label class="filter"
      ><input
        type="checkbox"
        .checked=${onlyProblems}
        @change=${(event: Event) => {
          onlyProblems = (event.target as HTMLInputElement).checked
          render()
        }}
      />
      Only rows that need attention</label
    >
    <button type="button" @click=${skipAll}>Skip all</button>
    <button type="button" @click=${reset}>Reset</button>
    <button type="button" @click=${cancel}>Cancel</button>
    <button
      type="button"
      class="primary"
      ?disabled=${approveHeld || !doc || pending || bad > 0}
      @click=${approve}
    >
      Approve
    </button>
  </div>`
}

function view() {
  return html`<header>
      <h1>Review extracted texts</h1>
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
  return table()
}

function skipAll() {
  for (const decision of decisions) decision.action = 'skip'
  render()
  void check()
}

function reset() {
  if (!doc) return
  decisions = doc.rows.map(initial)
  render()
  void check()
}

function schedule() {
  pending = true
  render()
  clearTimeout(timer)
  timer = setTimeout(() => void check(), 250)
}

async function check() {
  pending = true
  const mine = ++seq
  const { status, body } = await host.api('/api/check', { decisions })
  if (mine !== seq) return
  pending = false
  if (status !== 200) {
    host.alert(apiError(body))
    return
  }
  const checked = body as CheckBody
  errors = checked.errors ?? []
  warnings = checked.warnings ?? []
  render()
}

async function cancel() {
  const confirmed = await host.confirm(
    'Cancel the review? Nothing will change in the code.',
  )
  if (!confirmed) return
  await host.api('/api/cancel', {})
  done = {
    title: 'Review cancelled',
    text: `You can close this ${host.place} and return to your agent.`,
  }
  render()
}

async function approve() {
  approveHeld = true
  render()
  const { status, body } = await host.api('/api/submit', {
    decisions: decisions.map(({ action, key }) => ({ action, key })),
  })
  if (status === 200) {
    done = {
      title: 'Approved',
      text: `Your agent will now apply these decisions. You can close this ${host.place}.`,
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
  const loaded = body as ExtractReviewDoc & { settled?: boolean }
  if (loaded.settled) {
    metaOverride = ''
    done = {
      title: 'This review is closed',
      text: 'Return to your agent.',
    }
    render()
    return
  }
  doc = loaded
  decisions = loaded.rows.map(initial)
  render()
  void check()
}

void boot()
