/** The review page; everything inline so the server stays one route. */
export function reviewPage(token: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Localness review</title>
<style>
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --line: #d0d7de;
  --bg: #fff; --soft: #f6f8fa; --accent: #0969da; --bad: #cf222e; --good: #1a7f37; --warn: #9a6700; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d;
  --bg: #0d1117; --soft: #161b22; --accent: #4493f8; --bad: #f85149; --good: #3fb950; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
header { position: sticky; top: 0; z-index: 1; background: var(--bg); border-bottom: 1px solid var(--line); padding: 12px 20px; }
h1 { font-size: 16px; margin: 0 0 4px; }
.meta { color: var(--muted); font-size: 12px; }
.meta code { font-size: 12px; }
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
.bar .spacer { flex: 1; }
.counts span { margin-right: 10px; }
button { font: inherit; border: 1px solid var(--line); background: var(--soft); color: var(--fg); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--muted); }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--good); border-color: var(--good); color: #fff; }
main { padding: 0 20px 40px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; vertical-align: top; padding: 8px; border-bottom: 1px solid var(--line); }
th { font-size: 12px; color: var(--muted); font-weight: 600; }
td.num { width: 36px; color: var(--muted); font-variant-numeric: tabular-nums; }
.text { font-weight: 500; white-space: pre-wrap; word-break: break-word; }
.where { font-size: 12px; margin-top: 2px; }
.where a { color: var(--accent); text-decoration: none; }
.snippet { display: block; margin-top: 4px; font: 12px ui-monospace, monospace; color: var(--muted); white-space: pre-wrap; word-break: break-all; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.seg button { border: 0; border-radius: 0; background: transparent; padding: 3px 10px; }
.seg button + button { border-left: 1px solid var(--line); }
.seg button[aria-pressed="true"] { background: var(--accent); color: #fff; }
input[type=text], select { font: 13px ui-monospace, monospace; width: 100%; min-width: 220px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); }
input.bad, select.bad { border-color: var(--bad); }
input.warn, select.warn { border-color: var(--warn); }
.status { font-size: 12px; margin-top: 4px; min-height: 16px; }
.status.bad { color: var(--bad); }
.status.ok { color: var(--good); }
.status.warn { color: var(--warn); }
.hint { font-size: 12px; color: var(--muted); }
tr.skip .text, tr.skip .where { opacity: .5; }
.badge { font-size: 11px; padding: 0 5px; border-radius: 8px; border: 1px solid var(--line); color: var(--muted); }
.done { padding: 60px 20px; text-align: center; }
.done h2 { font-size: 18px; }
label.filter { font-size: 12px; color: var(--muted); display: inline-flex; gap: 4px; align-items: center; }
</style>
</head>
<body>
<header>
  <h1>Review extracted texts</h1>
  <div class="meta" id="meta">Loading…</div>
  <div class="bar">
    <span class="counts" id="counts"></span>
    <span class="spacer"></span>
    <label class="filter"><input type="checkbox" id="only-problems"> Only rows that need attention</label>
    <button id="all-skip">Skip all</button>
    <button id="all-default">Reset</button>
    <button id="cancel">Cancel</button>
    <button id="approve" class="primary" disabled>Approve</button>
  </div>
</header>
<main id="main"></main>
<script>
const TOKEN = ${JSON.stringify(token)};
const api = (path, body) => fetch(path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-review-token': TOKEN, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (res) => ({ status: res.status, body: await res.json() }));

let doc, decisions = [], errors = [], warnings = [], seq = 0, timer;
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child != null) node.append(child);
  return node;
};

function initial(row) {
  if (row.candidates.length === 1) return { action: 'reuse', key: row.candidates[0].key };
  if (row.candidates.length > 1) return { action: 'reuse', key: '' };
  return { action: 'create', key: row.suggestion };
}

function fileLink(row) {
  if (!row.file) return null;
  const label = row.file + (row.line ? ':' + row.line : '');
  if (!row.path) return el('span', { textContent: label });
  const path = row.path.replace(/\\\\/g, '/');
  const href = doc.editor + '://file/' + (path.startsWith('/') ? '' : '/') + encodeURI(path) + (row.line ? ':' + row.line : '');
  return el('a', { href, textContent: label, title: 'Open in editor' });
}

function conventionText(c) {
  if (!c) return 'no key convention';
  const style = c.style === 'none' ? 'any casing' : c.style;
  const parts = ['suggested: ' + style, 'separator "' + c.separator + '"', 'max depth ' + c.maxDepth];
  if (c.prefix) parts.unshift('prefix "' + c.prefix + '"');
  return parts.join(', ');
}

function render() {
  const onlyProblems = $('only-problems').checked;
  const body = el('tbody');
  doc.rows.forEach((row, i) => {
    const d = decisions[i], error = errors[i], warning = warnings[i];
    const mark = error ? 'bad' : warning ? 'warn' : '';
    if (onlyProblems && !error && !warning && !(d.action === 'reuse' && row.candidates.length > 1)) return;
    const seg = el('div', { className: 'seg' });
    const actions = [['reuse', 'Reuse'], ['create', 'New key'], ['skip', 'Skip']];
    for (const [action, label] of actions) {
      const button = el('button', { textContent: label, disabled: action === 'reuse' && row.candidates.length === 0 });
      button.setAttribute('aria-pressed', String(d.action === action));
      button.onclick = () => {
        if (d.action === action) return;
        d.action = action;
        if (action === 'reuse') d.key = row.candidates.length === 1 ? row.candidates[0].key : '';
        if (action === 'create') d.key = d.created ?? row.suggestion;
        render(); check();
      };
      seg.append(button);
    }
    let field = null;
    if (d.action === 'reuse') {
      field = el('select', { className: mark });
      if (row.candidates.length > 1) field.append(el('option', { value: '', textContent: 'Pick a key…' }));
      for (const c of row.candidates) {
        const tag = c.source === 'local' ? ' (local, not pushed)' : c.draft ? ' (draft)' : '';
        field.append(el('option', { value: c.key, textContent: c.key + tag, selected: c.key === d.key }));
      }
      field.onchange = () => { d.key = field.value; check(); };
    } else if (d.action === 'create') {
      field = el('input', { type: 'text', value: d.key, className: mark, placeholder: 'new key name', spellcheck: false });
      field.oninput = () => { d.key = d.created = field.value; schedule(); };
    }
    const status = d.action === 'skip' ? el('div', { className: 'status hint', textContent: 'Left as is in the code.' })
      : el('div', { className: 'status ' + (mark || 'ok'), textContent: error ?? warning ?? (pending ? '' : '✓') });
    const where = el('div', { className: 'where' }, fileLink(row),
      row.snippet ? el('code', { className: 'snippet', textContent: row.snippet }) : null);
    const matches = row.candidates.length ? el('span', { className: 'badge', textContent: row.candidates.length + ' match' + (row.candidates.length > 1 ? 'es' : '') }) : null;
    body.append(el('tr', { className: d.action === 'skip' ? 'skip' : '' },
      el('td', { className: 'num', textContent: String(row.index) }),
      el('td', {}, el('div', { className: 'text', textContent: row.text }), where),
      el('td', {}, seg, ' ', matches),
      el('td', {}, field, status)));
  });
  const table = el('table', {},
    el('thead', {}, el('tr', {}, ...['#', 'Text', 'Action', 'Key'].map((h) => el('th', { textContent: h })))), body);
  $('main').replaceChildren(table);
  const count = (action) => decisions.filter((d) => d.action === action).length;
  const bad = errors.filter(Boolean).length;
  const off = warnings.filter(Boolean).length;
  $('counts').replaceChildren(
    el('span', { textContent: count('reuse') + ' reuse' }),
    el('span', { textContent: count('create') + ' new' }),
    el('span', { textContent: count('skip') + ' skip' }),
    el('span', { textContent: bad ? bad + ' to fix' : '', style: 'color: var(--bad)' }),
    el('span', { textContent: off ? off + ' off the suggested style' : '', style: 'color: var(--warn)' }));
  $('approve').disabled = pending || bad > 0;
}

let pending = false;
function schedule() {
  pending = true;
  $('approve').disabled = true;
  clearTimeout(timer);
  timer = setTimeout(check, 250);
}

async function check() {
  pending = true;
  const mine = ++seq;
  const { status, body } = await api('/api/check', { decisions });
  if (mine !== seq) return;
  pending = false;
  if (status !== 200) { alert(body.error); return; }
  const focused = document.activeElement;
  const index = focused && focused.closest('tr') ? [...document.querySelectorAll('tbody tr')].indexOf(focused.closest('tr')) : -1;
  const caret = focused && focused.selectionStart;
  errors = body.errors;
  warnings = body.warnings ?? [];
  render();
  if (index >= 0 && focused.tagName === 'INPUT') {
    const input = document.querySelectorAll('tbody tr')[index]?.querySelector('input');
    if (input) { input.focus(); input.setSelectionRange(caret, caret); }
  }
}

function finish(title, text) {
  document.querySelector('header .bar').remove();
  $('main').replaceChildren(el('div', { className: 'done' }, el('h2', { textContent: title }), el('p', { className: 'hint', textContent: text })));
}

$('only-problems').onchange = render;
$('all-skip').onclick = () => { decisions.forEach((d) => { d.action = 'skip'; }); render(); check(); };
$('all-default').onclick = () => { decisions = doc.rows.map(initial); render(); check(); };
$('cancel').onclick = async () => {
  if (!confirm('Cancel the review? Nothing will change in the code.')) return;
  await api('/api/cancel', {});
  finish('Review cancelled', 'You can close this tab and return to your agent.');
};
$('approve').onclick = async () => {
  $('approve').disabled = true;
  const { status, body } = await api('/api/submit', { decisions: decisions.map(({ action, key }) => ({ action, key })) });
  if (status === 200) return finish('Approved', 'Your agent will now apply these decisions. You can close this tab.');
  if (body.errors) { errors = body.errors; render(); } else alert(body.error);
};

api('/api/review').then(({ status, body }) => {
  if (status !== 200) { $('meta').textContent = body.error; return; }
  doc = body;
  if (doc.settled) { $('meta').textContent = ''; return finish('This review is closed', 'Return to your agent.'); }
  $('meta').replaceChildren(doc.project + ' · source locale ' + doc.sourceLocale + ' · ',
    el('code', { textContent: conventionText(doc.convention) }),
    doc.namespaces.length ? ' · namespaces: ' + doc.namespaces.join(', ') : '');
  decisions = doc.rows.map(initial);
  render(); check();
});
</script>
</body>
</html>
`
}
