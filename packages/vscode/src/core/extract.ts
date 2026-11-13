export interface KeyMatch {
  key: string
  /** Offsets of the key text itself, quotes excluded. */
  start: number
  end: number
}

const CALLEE = String.raw`(?:(?<![\w$.])|\b(?:this|i18n(?:\.global)?)\.)\$?t\(\s*`
const KEYPATH = String.raw`<i18n-t\b[^>]*?\skeypath\s*=\s*`

const BODIES = {
  "'": String.raw`[^'\\\n]+`,
  '"': String.raw`[^"\\\n]+`,
  '`': String.raw`(?:(?!\$\{)[^` + '`' + String.raw`\\\n])+`,
} as const

function quoted(quote: keyof typeof BODIES) {
  return `${quote}(${BODIES[quote]})${quote}`
}

export const DEFAULT_KEY_PATTERNS: readonly string[] = [
  ...(Object.keys(BODIES) as Array<keyof typeof BODIES>).map(
    (quote) => CALLEE + quoted(quote),
  ),
  ...(["'", '"'] as const).map((quote) => KEYPATH + quoted(quote)),
]

export interface PatternError {
  source: string
  message: string
}

export interface CompiledPatterns {
  regexes: RegExp[]
  errors: PatternError[]
}

export function compilePatterns(sources: readonly string[]): CompiledPatterns {
  const regexes: RegExp[] = []
  const errors: PatternError[] = []
  for (const source of sources) {
    try {
      regexes.push(new RegExp(source, 'g'))
    } catch (error) {
      errors.push({
        source,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { regexes, errors }
}

export function patternSources(
  custom: readonly string[],
  useDefaults: boolean,
): string[] {
  return [...(useDefaults ? DEFAULT_KEY_PATTERNS : []), ...custom]
}

/** Index of the opening paren of the first capturing group, or -1. */
function firstCaptureParen(source: string): number {
  let inClass = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '\\') i++
    else if (inClass) inClass = char !== ']'
    else if (char === '[') inClass = true
    else if (char === '(') {
      if (source[i + 1] !== '?') return i
      if (source[i + 2] === '<' && !/[=!]/.test(source[i + 3] ?? '')) return i
    }
  }
  return -1
}

/**
 * Companion regex that matches exactly like `regex` but also captures
 * everything after the point where group 1 starts (as a new group 1, so the
 * key becomes group 2). `text.length - remainder.length` is then the exact
 * start offset of group 1, without needing the `d` flag.
 */
function probeFor(regex: RegExp): RegExp | undefined {
  const at = firstCaptureParen(regex.source)
  if (at < 0) return undefined
  const flags = regex.flags.replace(/[gy]/g, '') + 'y'
  try {
    return new RegExp(
      `${regex.source.slice(0, at)}(?=([\\s\\S]*))${regex.source.slice(at)}`,
      flags,
    )
  } catch {
    return undefined
  }
}

const probes = new WeakMap<RegExp, RegExp | undefined>()

function keyStart(text: string, regex: RegExp, match: RegExpExecArray) {
  const key = match[1]!
  if (!probes.has(regex)) probes.set(regex, probeFor(regex))
  const probe = probes.get(regex)
  if (probe) {
    probe.lastIndex = match.index
    const hit = probe.exec(text)
    if (hit && hit[0] === match[0] && hit[2] === key) {
      return text.length - hit[1]!.length
    }
  }
  // Patterns the probe cannot model (e.g. numbered backreferences):
  // best-effort guess using the last occurrence of the key in the match.
  return match.index + match[0].lastIndexOf(key)
}

export function extractKeys(
  text: string,
  regexes: readonly RegExp[],
): KeyMatch[] {
  const byStart = new Map<number, KeyMatch>()
  for (const regex of regexes) {
    regex.lastIndex = 0
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      if (match[0] === '') regex.lastIndex += 1
      const key = match[1]
      if (!key || key.includes('${')) continue
      const start = keyStart(text, regex, match)
      if (!byStart.has(start)) {
        byStart.set(start, { key, start, end: start + key.length })
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.start - b.start)
}
