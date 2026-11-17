import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXTRACT_TEMPLATES,
  locateExtraction,
  mergeExtractTemplates,
  renderExtraction,
  type ExtractSite,
} from '../src/core/extractText'

describe('mergeExtractTemplates', () => {
  it('keeps defaults for missing entries and entries without {key}', () => {
    const templates = mergeExtractTemplates({
      script: "i18n.t('{key}')",
      jsxText: '{t()}',
    })
    expect(templates.script).toBe("i18n.t('{key}')")
    expect(templates.jsxText).toBe(DEFAULT_EXTRACT_TEMPLATES.jsxText)
    expect(mergeExtractTemplates(undefined)).toEqual(DEFAULT_EXTRACT_TEMPLATES)
  })
})

/** `«…»` marks the selection. */
function locate(marked: string, languageId: string) {
  const start = marked.indexOf('«')
  const end = marked.indexOf('»') - 1
  const source = marked.replace('«', '').replace('»', '')
  return { source, result: locateExtraction(source, start, end, languageId) }
}

function replaced(marked: string, languageId: string, key = 'app.title') {
  const { source, result } = locate(marked, languageId)
  if ('error' in result) throw new Error(result.error)
  return (
    source.slice(0, result.start) +
    renderExtraction(DEFAULT_EXTRACT_TEMPLATES, result, key) +
    source.slice(result.end)
  )
}

function errorOf(marked: string, languageId: string) {
  const { result } = locate(marked, languageId)
  return 'error' in result ? result.error : undefined
}

const vue = (template: string, script = '') =>
  `<template>\n${template}\n</template>\n<script setup>\n${script}\n</script>\n`

describe('locateExtraction', () => {
  it('extracts Vue text between tags, collapsing whitespace', () => {
    const { result } = locate(vue('<p>«Hello\n    world»</p>'), 'vue')
    expect(result).toMatchObject({ kind: 'vueText', text: 'Hello world' })
    expect(replaced(vue('<p>« Hello »</p>'), 'vue')).toBe(
      vue("<p> {{ $t('app.title') }} </p>"),
    )
  })

  it('binds a static Vue attribute, with or without its quotes selected', () => {
    const expected = vue(`<input :placeholder="$t('app.title')" />`)
    expect(replaced(vue('<input placeholder="«Email»" />'), 'vue')).toBe(
      expected,
    )
    expect(replaced(vue('<input placeholder=«"Email"» />'), 'vue')).toBe(
      expected,
    )
    expect(
      locate(vue('<input\n  aria-label="«Close»" />'), 'vue').result,
    ).toMatchObject({ kind: 'vueAttr', attr: 'aria-label', text: 'Close' })
  })

  it('rejects an attribute that is already bound', () => {
    expect(errorOf(vue(`<p :title="«'x'»" />`), 'vue')).toBeUndefined()
    expect(errorOf(vue('<p :title=«"x"» />'), 'vue')).toMatch(/already bound/)
  })

  it('treats a string in a Vue expression as an expression', () => {
    expect(replaced(vue(`<p :title="«'Hi'»" />`), 'vue')).toBe(
      vue(`<p :title="$t('app.title')" />`),
    )
    expect(replaced(vue("<p>{{ ok ? «'Yes'» : 'No' }}</p>"), 'vue')).toBe(
      vue("<p>{{ ok ? $t('app.title') : 'No' }}</p>"),
    )
  })

  it('treats a string in a Vue script block as script', () => {
    expect(replaced(vue('<p />', "const a = '«Saved»'"), 'vue')).toBe(
      vue('<p />', "const a = t('app.title')"),
    )
  })

  it('does not take an assignment for an attribute', () => {
    expect(
      locate('const label = "«Save»"', 'typescriptreact').result,
    ).toMatchObject({ kind: 'script', text: 'Save' })
  })

  it('extracts JSX text and attributes', () => {
    expect(replaced('return <b>«Sign in»</b>', 'typescriptreact')).toBe(
      "return <b>{t('app.title')}</b>",
    )
    expect(replaced('<input placeholder="«Email»" />', 'javascriptreact')).toBe(
      "<input placeholder={t('app.title')} />",
    )
  })

  it('unescapes the string', () => {
    expect(locate(`t2 = '«It\\'s\\nfine»'`, 'typescript').result).toMatchObject(
      {
        text: "It's\nfine",
      },
    )
  })

  it('rejects interpolation, expressions and unquoted script', () => {
    expect(errorOf('const a = `«Hi ${name}»`', 'typescript')).toMatch(/\$\{/)
    expect(errorOf(vue('<p>«Hi {{ name }}»</p>'), 'vue')).toBeDefined()
    expect(errorOf('<b>{«count»}</b>', 'typescriptreact')).toMatch(
      /inside the expression/,
    )
    expect(errorOf('const a = «label»', 'typescript')).toMatch(/whole string/)
    expect(errorOf("const a = '«  »'", 'typescript')).toBeDefined()
  })
})

describe('renderExtraction', () => {
  it('fills the key and the attribute name', () => {
    const site: ExtractSite = {
      kind: 'jsxAttr',
      text: 'Email',
      start: 0,
      end: 0,
      attr: 'title',
    }
    expect(renderExtraction(DEFAULT_EXTRACT_TEMPLATES, site, 'a.b')).toBe(
      "title={t('a.b')}",
    )
  })
})
