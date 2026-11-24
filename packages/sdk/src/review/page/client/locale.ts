import { FLAGS } from './flags.gen'

/** Chinese is named by script, matching the extension, so no region flag is used. */
const CHINESE: Record<string, { name: string; flag: string }> = {
  Hans: { name: '中文（简体）', flag: 'zh-hans' },
  Hant: { name: '中文（繁体）', flag: 'zh-hant' },
}

function maximize(locale: string) {
  try {
    return new Intl.Locale(locale.replace(/_/g, '-')).maximize()
  } catch {
    return undefined
  }
}

function chineseOf(locale: string) {
  const tag = maximize(locale)
  return tag?.language === 'zh' && tag.script ? CHINESE[tag.script] : undefined
}

/** The locale's name in its own language, e.g. `de` → `Deutsch`. */
export function localeName(locale: string) {
  const script = chineseOf(locale)
  if (script) return script.name
  const tag = maximize(locale)
  if (!tag) return locale
  try {
    const code = locale.replace(/_/g, '-')
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    if (!name || name === code) return locale
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
  } catch {
    return locale
  }
}

let stamp = 0

/**
 * The flag markup. Ids are rewritten per call: the same flag can appear on
 * several rows, and a marker id has to stay unique in the document.
 */
export function localeFlag(locale: string) {
  const script = chineseOf(locale)
  const region = maximize(locale)?.region?.toLowerCase()
  const raw = script ? FLAGS[script.flag] : region ? FLAGS[region] : undefined
  if (!raw) return undefined
  const mark = ++stamp
  return raw
    .replace(/\bid="([^"]+)"/g, (_match, id: string) => `id="${id}-${mark}"`)
    .replace(/url\(#([^)]+)\)/g, (_match, id: string) => `url(#${id}-${mark})`)
}
