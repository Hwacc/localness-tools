/** Where selected text sits, which decides how its replacement is written. */
export type SiteKind =
  'vueText' | 'vueAttr' | 'vueExpr' | 'jsxText' | 'jsxAttr' | 'script'

export type ExtractTemplates = Record<SiteKind, string>

/** `{key}` is the key name, `{attr}` the attribute name. */
export const DEFAULT_EXTRACT_TEMPLATES: ExtractTemplates = {
  vueText: "{{ $t('{key}') }}",
  vueAttr: ':{attr}="$t(\'{key}\')"',
  vueExpr: "$t('{key}')",
  jsxText: "{t('{key}')}",
  jsxAttr: "{attr}={t('{key}')}",
  script: "t('{key}')",
}

/** Configured templates over the defaults; an entry without `{key}` keeps the default. */
export function mergeExtractTemplates(
  saved: Readonly<Record<string, string>> | undefined,
): ExtractTemplates {
  const templates = { ...DEFAULT_EXTRACT_TEMPLATES }
  for (const kind of Object.keys(templates) as SiteKind[]) {
    const value = saved?.[kind]
    if (value?.includes('{key}')) templates[kind] = value
  }
  return templates
}

export interface ExtractSite {
  kind: SiteKind
  /** The text to store as the source text. */
  text: string
  /** Offsets of the code the replacement takes the place of. */
  start: number
  end: number
  attr?: string
}

export type ExtractResult = ExtractSite | { error: string }

const QUOTES = new Set(["'", '"', '`'])
const JSX_LANGUAGES = new Set(['typescriptreact', 'javascriptreact'])
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r' }
/** `name=` (or `name = `) right before an attribute's opening quote. */
const ATTRIBUTE = /(?:^|\s)([^\s=<>"'`/{}]+)\s*=\s*$/
const ATTRIBUTE_LOOKBEHIND = 200

function unescape(text: string) {
  return text.replace(/\\(.)/g, (_, char: string) => ESCAPES[char] ?? char)
}

/** Offsets inside the first top-level `<template>` of a Vue file. */
function vueTemplateRange(source: string) {
  const open = /^<template\b[^>]*>/m.exec(source)
  const close = source.lastIndexOf('</template>')
  if (!open || close < 0) return undefined
  return { start: open.index + open[0].length, end: close }
}

/** True when `offset` is inside a tag's `<…>`, not between tags. */
function insideTag(source: string, offset: number) {
  const before = source.slice(0, offset)
  const open = before.lastIndexOf('<')
  return (
    open > before.lastIndexOf('>') && /[A-Za-z]/.test(source[open + 1] ?? '')
  )
}

function quotedSpan(source: string, start: number, end: number) {
  const first = source[start]!
  if (end - start >= 2 && QUOTES.has(first) && source[end - 1] === first) {
    return { quote: first, start, end }
  }
  const before = source[start - 1]
  if (before && QUOTES.has(before) && source[end] === before) {
    return { quote: before, start: start - 1, end: end + 1 }
  }
  return undefined
}

function attributeBefore(source: string, quoteStart: number) {
  const window = source.slice(
    Math.max(0, quoteStart - ATTRIBUTE_LOOKBEHIND),
    quoteStart,
  )
  const match = ATTRIBUTE.exec(window)
  if (!match) return undefined
  const name = match[1]!
  const start =
    quoteStart - window.length + match.index + match[0].indexOf(name)
  return insideTag(source, start) ? { name, start } : undefined
}

function isVueBinding(attr: string) {
  return /^(?::|@|#|v-)/.test(attr)
}

/**
 * Finds how to replace the selection `[start, end)` with a key. A selection
 * touching a string's quotes takes the whole string; one between tags is
 * markup text. Rules, not a parser: good enough for a selection the user made.
 */
export function locateExtraction(
  source: string,
  start: number,
  end: number,
  languageId: string,
): ExtractResult {
  while (start < end && /\s/.test(source[start]!)) start++
  while (end > start && /\s/.test(source[end - 1]!)) end--
  if (start === end) return { error: 'Select the text to extract.' }

  const template = languageId === 'vue' ? vueTemplateRange(source) : undefined
  const inTemplate =
    !!template && start >= template.start && end <= template.end
  const jsx = JSX_LANGUAGES.has(languageId)

  const quoted = quotedSpan(source, start, end)
  if (quoted) {
    const raw = source.slice(quoted.start + 1, quoted.end - 1)
    if (quoted.quote === '`' && raw.includes('${')) {
      return { error: 'Strings with ${…} placeholders are not supported yet.' }
    }
    const text = unescape(raw)
    if (!text.trim()) return { error: 'The string is empty.' }
    const attr =
      (inTemplate || jsx) && quoted.quote !== '`'
        ? attributeBefore(source, quoted.start)
        : undefined
    if (attr && inTemplate) {
      if (isVueBinding(attr.name)) {
        return {
          error: `${attr.name} is already bound; select a string inside its expression.`,
        }
      }
      return {
        kind: 'vueAttr',
        text,
        start: attr.start,
        end: quoted.end,
        attr: attr.name,
      }
    }
    if (attr && jsx) {
      return {
        kind: 'jsxAttr',
        text,
        start: attr.start,
        end: quoted.end,
        attr: attr.name,
      }
    }
    return {
      kind: inTemplate ? 'vueExpr' : 'script',
      text,
      start: quoted.start,
      end: quoted.end,
    }
  }

  if (inTemplate || jsx) {
    const node = textNodeAround(source, start, end, jsx)
    if (node === 'expression') {
      return {
        error: 'Select a string inside the expression, with its quotes.',
      }
    }
    if (node) {
      return {
        kind: inTemplate ? 'vueText' : 'jsxText',
        text: source.slice(start, end).replace(/\s+/g, ' '),
        start,
        end,
      }
    }
  }
  return { error: 'Select a whole string, with or without its quotes.' }
}

/**
 * Whether `[start, end)` is plain text between a `>` and the next `<`. Inside
 * `{…}` / `{{…}}` it is code instead. JSX text holding `;` is taken for code
 * that happens to sit between a `>` and a `<`, such as a comparison.
 */
function textNodeAround(
  source: string,
  start: number,
  end: number,
  jsx: boolean,
): boolean | 'expression' {
  const open = source.lastIndexOf('>', start - 1)
  const close = source.indexOf('<', end)
  if (open < 0 || close < 0) return false
  if (source.lastIndexOf('<', start - 1) > open) return false
  const nextGt = source.indexOf('>', end)
  if (nextGt >= 0 && nextGt < close) return false
  const selected = source.slice(start, end)
  if (/[<>]/.test(selected)) return false
  const before = source.slice(open + 1, start)
  const depth = (text: string) =>
    (text.match(/\{/g)?.length ?? 0) - (text.match(/\}/g)?.length ?? 0)
  if (depth(before) > 0 || /[{}]/.test(selected)) return 'expression'
  if (jsx && /;/.test(before + selected + source.slice(end, close)))
    return false
  return true
}

export function renderExtraction(
  templates: ExtractTemplates,
  site: ExtractSite,
  key: string,
) {
  return templates[site.kind]
    .replaceAll('{key}', key)
    .replaceAll('{attr}', site.attr ?? '')
}
