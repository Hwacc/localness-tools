import { html, nothing, render as renderHtml } from 'lit-html'
import { repeat } from 'lit-html/directives/repeat.js'
import type {
  ResolveAction,
  ResolveCell,
  ResolveDecision,
  ResolveLocation,
  ResolveReviewDoc,
  ResolveRow,
} from '../../resolve'
import { apiError, pageHost, reviewRoot } from './host'

const host = pageHost()
const root = reviewRoot()

const KIND_LABEL: Partial<Record<ResolveCell['kind'], string>> = {
  'platform-added': 'New on remote',
  'platform-changed': 'Changed on remote',
  'platform-deleted': 'Removed from remote',
  'local-deleted': 'Removed locally',
  different: 'Different, no base',
  conflict: 'Conflict',
  duplicate: 'In several directories',
}

const ACTION_LABEL: Record<ResolveAction, string> = {
  pull: 'Remote',
  push: 'Local',
  prune: 'Delete locally',
  skip: 'Skip',
}

interface CheckBody {
  errors?: (string | null)[][]
}

let doc: ResolveReviewDoc | null = null
let decisions: ResolveDecision[][] = []
let errors: (string | null)[][] = []
const openRows = new Set<number>()
let kindFilter = ''
let pending = false
let approveHeld = false
let seq = 0
let note = ''
let metaOverride: string | null = null
let done: { title: string; text: string } | null = null

function kindLabel(kind: ResolveCell['kind']) {
  return KIND_LABEL[kind] ?? kind
}

function quote(text: string | null | undefined) {
  if (text === null || text === undefined) return '(none)'
  const shown = text.length > 40 ? `${text.slice(0, 39)}…` : text
  return `"${shown}"`
}

function arrow(cell: ResolveCell) {
  const local = `locale file ${quote(cell.local)}`
  const remote = `remote ${quote(cell.platform)}`
  switch (cell.newer) {
    case 'remote':
      return `${local} → ${remote}`
    case 'local':
      return `${remote} → ${local}`
    case null:
      return `${remote} ↔ ${local}`
    default: {
      const unhandled: never = cell.newer
      return unhandled
    }
  }
}

function sharedActions(row: ResolveRow) {
  const first = row.cells[0]
  if (!first) return []
  return first.allowed.filter((action) =>
    row.cells.every((cell) => cell.allowed.includes(action)),
  )
}

function sameAction(index: number): ResolveAction | '' {
  const row = decisions[index]
  const first = row?.[0]?.action
  if (!row || first === undefined) return ''
  return row.every((decision) => decision.action === first) ? first : ''
}

function setCells(take: (cell: ResolveCell) => ResolveAction) {
  if (!doc) return
  for (const [index, row] of doc.rows.entries()) {
    for (const [cellIndex, cell] of row.cells.entries()) {
      const action = take(cell)
      const decision = decisions[index]?.[cellIndex]
      if (decision && cell.allowed.includes(action)) decision.action = action
    }
  }
}

function count(action: ResolveAction) {
  return decisions.flat().filter((decision) => decision.action === action)
    .length
}

function problemCount() {
  return errors.reduce(
    (sum, row) => sum + (row ?? []).filter(Boolean).length,
    0,
  )
}

function payload() {
  return decisions.map((row) =>
    row.map((decision) => ({
      action: decision.action,
      into: decision.into || undefined,
    })),
  )
}

function noteText(loaded: ResolveReviewDoc) {
  const lines: string[] = []
  if (!loaded.hasBase) {
    lines.push(
      'First sync: there is no base yet, so every changed text is different.',
    )
  }
  if (loaded.empties.length) {
    const shown = loaded.empties
      .slice(0, 20)
      .map((item) => `${item.key} (${item.locale})`)
      .join(', ')
    const more =
      loaded.empties.length > 20
        ? `, and ${loaded.empties.length - 20} more`
        : ''
    lines.push(`Empty locally, left out of this review: ${shown}${more}.`)
  }
  return lines.join(' ')
}

function kindsOf(loaded: ResolveReviewDoc) {
  const kinds: ResolveCell['kind'][] = []
  for (const row of loaded.rows) {
    for (const cell of row.cells) {
      if (!kinds.includes(cell.kind)) kinds.push(cell.kind)
    }
  }
  return kinds
}

function skipHint(cell: ResolveCell, action: ResolveAction) {
  if (action !== 'skip') return ''
  if (cell.kind === 'duplicate') {
    return 'Skipped: delete the extra copies by hand.'
  }
  if (cell.kind === 'local-deleted') {
    return 'Remote still has it; deleting it happens in the web app.'
  }
  if (cell.kind === 'platform-deleted') return 'The locale file keeps it.'
  return 'Left as it is.'
}

function render() {
  renderHtml(view(), root)
}

function meta() {
  if (metaOverride !== null) return metaOverride
  if (!doc) return 'Loading…'
  const where = doc.config ? ` · ${doc.config}` : ''
  return `${doc.project} · source locale ${doc.sourceLocale}${where}`
}

function fileLink(location: ResolveLocation, key: string) {
  if (!doc) return nothing
  const openLocation = host.openLocation
  if (openLocation) {
    return html`<a
      href="#"
      title="Open in editor"
      @click=${(event: Event) => {
        event.preventDefault()
        openLocation(location.path, key)
      }}
      >${location.relativePath}</a
    >`
  }
  const path = location.path.replace(/\\/g, '/')
  const href = `${doc.editor}://file/${path.startsWith('/') ? '' : '/'}${encodeURI(path)}`
  return html`<a href=${href} title="Open in editor"
    >${location.relativePath}</a
  >`
}

function statusLine(error: string | null | undefined, skipped: string) {
  const text = error || skipped || (pending ? '' : '✓')
  const tone = error ? 'bad' : skipped ? 'hint' : 'ok'
  return html`<div class="status ${tone}">${text}</div>`
}

function previewLine(cell: ResolveCell) {
  const text = `${cell.locale} · ${kindLabel(cell.kind)} · ${arrow(cell)}`
  return html`<div>${text}</div>`
}

function side(label: string, text: string | null) {
  const value = text === null ? '(none)' : text
  // The box keeps whitespace, so the value cannot sit on its own line.
  // prettier-ignore
  return html`<div class="box"><span class="label">${label}</span>${value}</div>`
}

function actionSeg(
  allowed: readonly ResolveAction[],
  current: string,
  onPick: (action: ResolveAction) => void,
) {
  return html`<div class="seg">
    ${allowed.map(
      (action) =>
        html`<button
          type="button"
          aria-pressed=${String(current === action)}
          @click=${() => {
            if (current !== action) onPick(action)
          }}
        >
          ${ACTION_LABEL[action]}
        </button>`,
    )}
  </div>`
}

function directorySelect(
  decision: ResolveDecision,
  error: string | null | undefined,
) {
  if (!doc) return nothing
  return html`<select
    class=${error ? 'bad' : ''}
    @change=${(event: Event) => {
      decision.into = (event.target as HTMLSelectElement).value
      void check()
    }}
  >
    <option
      value=""
      ?selected=${!decision.into}
      .textContent=${'Pick a directory…'}
    ></option>
    ${doc.dirs.map(
      (dir) =>
        html`<option
          value=${dir}
          ?selected=${dir === (decision.into || '')}
          .textContent=${dir}
        ></option>`,
    )}
  </select>`
}

function localeBlock(
  row: ResolveRow,
  cell: ResolveCell,
  rowIndex: number,
  cellIndex: number,
) {
  const decision = decisions[rowIndex]?.[cellIndex]
  if (!decision) return nothing
  const error = errors[rowIndex]?.[cellIndex]
  const remoteLabel =
    cell.draft !== null && cell.draft !== cell.platform
      ? 'Remote (published)'
      : 'Remote'
  const skipped = skipHint(cell, decision.action)
  const showDraft = cell.draft !== null && cell.draft !== cell.platform
  return html`<div class="locale">
    <div>
      <strong>${cell.locale}</strong>
      <span class="badge">${kindLabel(cell.kind)}</span>
      <span class="hint"> ${arrow(cell)}</span>
    </div>
    <div class="pair">
      ${side('Locale file', cell.local)}${side(remoteLabel, cell.platform)}
    </div>
    ${showDraft ? side('Remote draft', cell.draft) : nothing}
    ${
      cell.base !== null
        ? html`<div class="hint">Last synced: ${quote(cell.base)}</div>`
        : nothing
    }
    ${
      cell.locations.length
        ? html`<div class="where">
            ${cell.locations.map(
              (location, index) =>
                html`${index ? ' · ' : nothing}${fileLink(location, row.key)}`,
            )}
          </div>`
        : nothing
    }
    ${actionSeg(cell.allowed, decision.action, (action) => {
      decision.action = action
      render()
      void check()
    })}
    ${
      decision.action === 'pull' && cell.needsInto
        ? directorySelect(decision, error)
        : nothing
    }
    ${statusLine(error, skipped)}
  </div>`
}

function toggle(index: number) {
  if (openRows.has(index)) openRows.delete(index)
  else openRows.add(index)
  render()
}

function rowView(row: ResolveRow, index: number) {
  const current = sameAction(index)
  const firstError = (errors[index] ?? []).find((error) => error)
  const open = openRows.has(index)
  return html`<tr class=${current === 'skip' ? 'skip' : ''}>
      <td class="num">${row.index}</td>
      <td>
        <div class="text">${row.key}</div>
        <div class="preview">${row.cells.map((cell) => previewLine(cell))}</div>
        ${
          firstError
            ? html`<div class="status bad">${firstError}</div>`
            : nothing
        }
      </td>
      <td>
        ${actionSeg(sharedActions(row), current, (action) => {
          for (const [cellIndex, decision] of (
            decisions[index] ?? []
          ).entries()) {
            if (row.cells[cellIndex]?.allowed.includes(action)) {
              decision.action = action
            }
          }
          render()
          void check()
        })}
      </td>
      <td>
        <button type="button" @click=${() => toggle(index)}>
          ${open ? 'Hide' : 'Per locale'} (${row.cells.length})
        </button>
      </td>
    </tr>
    ${
      open
        ? html`<tr>
            <td class="detail" colspan="4">
              ${row.cells.map((cell, cellIndex) =>
                localeBlock(row, cell, index, cellIndex),
              )}
            </td>
          </tr>`
        : nothing
    }`
}

function shown() {
  if (!doc) return []
  return doc.rows.flatMap((row, index) =>
    !kindFilter || row.cells.some((cell) => cell.kind === kindFilter)
      ? [{ row, index }]
      : [],
  )
}

function table() {
  return html`<table>
    <thead>
      <tr>
        <th>#</th>
        <th>Key</th>
        <th>Action</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${repeat(
        shown(),
        (item) => item.row.index,
        (item) => rowView(item.row, item.index),
      )}
    </tbody>
  </table>`
}

function toolbar() {
  const bad = problemCount()
  const kinds = doc ? kindsOf(doc) : []
  return html`<div class="bar">
    <span class="counts">
      <span>${count('pull')} remote</span>
      <span>${count('push')} local</span>
      <span>${count('prune')} delete</span>
      <span>${count('skip')} skip</span>
      <span class="bad-text">${bad ? `${bad} to fix` : ''}</span>
    </span>
    <span class="spacer"></span>
    <select
      title="Show keys of one kind"
      @change=${(event: Event) => {
        kindFilter = (event.target as HTMLSelectElement).value
        render()
      }}
    >
      <option value="" ?selected=${kindFilter === ''}>All kinds</option>
      ${kinds.map(
        (kind) =>
          html`<option
            value=${kind}
            ?selected=${kindFilter === kind}
            .textContent=${kindLabel(kind)}
          ></option>`,
      )}
    </select>
    <button type="button" @click=${allRemote}>All remote</button>
    <button type="button" @click=${allLocal}>All local</button>
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
      <h1>Resolve differences</h1>
      <div class="meta">${meta()}</div>
      <div class="note">${note}</div>
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

function allRemote() {
  setCells((cell) => (cell.allowed.includes('pull') ? 'pull' : 'prune'))
  render()
  void check()
}

function allLocal() {
  setCells(() => 'push')
  render()
  void check()
}

function skipAll() {
  setCells(() => 'skip')
  render()
  void check()
}

function reset() {
  if (!doc) return
  decisions = doc.rows.map((row) => row.cells.map(() => ({ action: 'skip' })))
  render()
  void check()
}

async function check() {
  pending = true
  const mine = ++seq
  const { status, body } = await host.api('/api/check', {
    decisions: payload(),
  })
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
    'Cancel? Nothing will change in the locale files.',
  )
  if (!confirmed) return
  await host.api('/api/cancel', {})
  done = {
    title: 'Resolve cancelled',
    text: `You can close this ${host.place} and return to your agent.`,
  }
  render()
}

async function approve() {
  approveHeld = true
  render()
  const { status, body } = await host.api('/api/submit', {
    decisions: payload(),
  })
  if (status === 200) {
    done = {
      title: 'Approved',
      text: `Your agent will run the commands from this page. You can close this ${host.place}.`,
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
  const loaded = body as ResolveReviewDoc & { settled?: boolean }
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
  note = noteText(loaded)
  decisions = loaded.rows.map((row) =>
    row.cells.map(() => ({ action: 'skip' })),
  )
  errors = loaded.rows.map((row) => row.cells.map(() => null))
  render()
  void check()
}

void boot()
