/** Regions whose flags ship with the extension; others fall back to a globe. */
export const FLAG_REGIONS = [
  'ae',
  'ar',
  'at',
  'au',
  'be',
  'br',
  'ca',
  'ch',
  'cn',
  'cz',
  'de',
  'dk',
  'eg',
  'es',
  'fi',
  'fr',
  'gb',
  'gr',
  'hk',
  'hu',
  'id',
  'ie',
  'il',
  'in',
  'it',
  'jp',
  'kr',
  'mx',
  'my',
  'nl',
  'no',
  'nz',
  'ph',
  'pl',
  'pt',
  'ro',
  'ru',
  'sa',
  'se',
  'sg',
  'th',
  'tr',
  'tw',
  'ua',
  'us',
  'vn',
  'za',
] as const

const flagRegions = new Set<string>(FLAG_REGIONS)

/** Accept `zh_CN`-style codes, which `Intl` rejects. */
function maximize(locale: string) {
  try {
    return new Intl.Locale(locale.replace(/_/g, '-')).maximize()
  } catch {
    return undefined
  }
}

/** Chinese is named by script, not region, to stay politically neutral. */
const CHINESE_SCRIPTS: Record<string, { name: string; icon: string }> = {
  Hans: { name: '中文（简体）', icon: 'media/zh-hans.svg' },
  Hant: { name: '中文（繁体）', icon: 'media/zh-hant.svg' },
}

function chineseScript(tag: Intl.Locale | undefined) {
  return tag?.language === 'zh' && tag.script
    ? CHINESE_SCRIPTS[tag.script]
    : undefined
}

/** The locale's name in its own language, e.g. `de` → `Deutsch`. */
export function localeName(locale: string): string {
  const tag = maximize(locale)
  const chinese = chineseScript(tag)
  if (chinese) return chinese.name
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

/**
 * Icon path relative to the extension root: a bundled flag of the locale's
 * likely region (`ja` → `jp`, `en` → `us`), or a script badge for Chinese.
 */
export function localeIcon(locale: string): string | undefined {
  const tag = maximize(locale)
  const chinese = chineseScript(tag)
  if (chinese) return chinese.icon
  const region = tag?.region?.toLowerCase()
  return region && flagRegions.has(region)
    ? `dist/flags/${region}.svg`
    : undefined
}
