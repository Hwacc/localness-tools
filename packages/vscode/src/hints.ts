import * as vscode from 'vscode'
import type { DataController } from './controller'
import {
  hintOffset,
  hintText,
  isRevealed,
  textFor,
  truncate,
} from './core/keys'
import type { DocumentKey, KeyMatcher } from './matcher'
import {
  readSettings,
  type InlineHintStyle,
  type ReplaceRevealOn,
} from './settings'

const HINT_COLOR = new vscode.ThemeColor('editorCodeLens.foreground')
const UNDERLINE_COLOR = new vscode.ThemeColor('textLink.foreground')

function inlineAttachment(
  style: InlineHintStyle,
  text: string,
): vscode.ThemableDecorationAttachmentRenderOptions {
  switch (style) {
    case 'inlay':
      return {
        contentText: `\u00a0${text}\u00a0`,
        color: new vscode.ThemeColor('editorInlayHint.foreground'),
        backgroundColor: new vscode.ThemeColor('editorInlayHint.background'),
        margin: '0 0 0 0.3em',
        // Not a public API: the string is copied into inline CSS.
        border: 'none; border-radius: 3px;',
      }
    case 'dot':
      return { contentText: `·${text}`, color: HINT_COLOR }
    case 'arrow':
      return { contentText: ` → ${text}`, color: HINT_COLOR }
    case 'plain':
      return { contentText: ` ${text}`, color: HINT_COLOR, fontStyle: 'italic' }
  }
}

/**
 * `line`: a cursor anywhere on the key's lines reveals it. `cursor`: the
 * cursor must touch the key or its quotes.
 */
function revealCheck(
  editor: vscode.TextEditor,
  text: string,
  on: ReplaceRevealOn,
): (match: DocumentKey) => boolean {
  const { document } = editor
  if (on === 'line') {
    const lines = editor.selections.map((selection) => ({
      start: selection.start.line,
      end: selection.end.line,
    }))
    return (match) =>
      isRevealed(
        { start: match.range.start.line, end: match.range.end.line },
        lines,
      )
  }
  const offsets = editor.selections.map((selection) => ({
    start: document.offsetAt(selection.start),
    end: document.offsetAt(selection.end),
  }))
  return (match) =>
    isRevealed(
      { start: match.start - 1, end: hintOffset(text, match) },
      offsets,
    )
}

export function registerInlineHints(
  controller: DataController,
  matcher: KeyMatcher,
): vscode.Disposable {
  const hints = vscode.window.createTextEditorDecorationType({})
  const underline = vscode.window.createTextEditorDecorationType({
    borderStyle: 'none none dotted none',
    borderWidth: '0 0 1px 0',
    borderColor: UNDERLINE_COLOR,
  })
  // Not a public API: VS Code copies textDecoration into inline CSS, which is
  // the only way to collapse the key text (same trick as i18n Ally).
  const hidden = vscode.window.createTextEditorDecorationType({
    textDecoration: 'none; display: none;',
  })
  let timer: ReturnType<typeof setTimeout> | undefined

  const update = (editor: vscode.TextEditor) => {
    const settings = readSettings()
    const data = controller.data
    const { document } = editor
    if (!data || !matcher.isSupported(document)) {
      for (const type of [hints, underline, hidden])
        editor.setDecorations(type, [])
      return
    }
    const text = document.getText()
    const revealed = revealCheck(editor, text, settings.replaceRevealOn)
    const hintOptions: vscode.DecorationOptions[] = []
    const underlineRanges: vscode.Range[] = []
    const hiddenRanges: vscode.Range[] = []
    for (const match of matcher.keysIn(document)) {
      const state = data.index.get(match.key)
      if (!state) continue
      const translation = textFor(state, data.displayLocale)
      const replace =
        settings.inlineHints === 'replace' &&
        translation !== undefined &&
        !revealed(match)
      if (replace) {
        hiddenRanges.push(match.range)
        hintOptions.push({
          range: match.range,
          renderOptions: {
            after: {
              contentText: truncate(translation, settings.inlineHintMaxLength),
              color: HINT_COLOR,
              ...(settings.keyUnderline && {
                textDecoration: 'underline dotted',
              }),
            },
          },
        })
        continue
      }
      if (settings.keyUnderline) underlineRanges.push(match.range)
      if (settings.inlineHints === 'off') continue
      if (settings.inlineHints === 'replace' && translation !== undefined)
        continue
      const position = document.positionAt(hintOffset(text, match))
      hintOptions.push({
        range: new vscode.Range(position, position),
        renderOptions: {
          after: inlineAttachment(
            settings.inlineHintStyle,
            hintText(state, data.displayLocale, settings.inlineHintMaxLength),
          ),
        },
      })
    }
    editor.setDecorations(hints, hintOptions)
    editor.setDecorations(underline, underlineRanges)
    editor.setDecorations(hidden, hiddenRanges)
  }

  const updateVisible = () => {
    for (const editor of vscode.window.visibleTextEditors) update(editor)
  }

  return vscode.Disposable.from(
    hints,
    underline,
    hidden,
    controller.onDidChange(updateVisible),
    vscode.window.onDidChangeVisibleTextEditors(updateVisible),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (readSettings().inlineHints === 'replace') update(event.textEditor)
    }),
    vscode.workspace.onDidChangeTextDocument(() => {
      clearTimeout(timer)
      timer = setTimeout(updateVisible, 300)
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('localness')) updateVisible()
    }),
    { dispose: () => clearTimeout(timer) },
  )
}
