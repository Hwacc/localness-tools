import {
  EXTRACT_SCRIPT,
  PLAN_SCRIPT,
  RESOLVE_SCRIPT,
  STYLE,
} from './bundle.gen'

export type ReviewPageHost =
  { host: 'browser'; token: string } | { host: 'webview'; nonce: string }

export type ReviewPageKind = 'extract' | 'resolve' | 'plan'

const TITLE: Record<ReviewPageKind, string> = {
  extract: 'Localness review',
  resolve: 'Localness resolve',
  plan: 'Localness push plans',
}

function pageScript(kind: ReviewPageKind) {
  switch (kind) {
    case 'extract':
      return EXTRACT_SCRIPT
    case 'resolve':
      return RESOLVE_SCRIPT
    case 'plan':
      return PLAN_SCRIPT
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

function escapeAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

/** A script can contain these sequences without closing the surrounding tag. */
function inlineScript(code: string) {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')
}

/** The page chrome. The script renders the review; this only carries it. */
export function reviewDocument(
  options: ReviewPageHost,
  kind: ReviewPageKind,
): string {
  const webview = options.host === 'webview'
  const nonce = webview ? options.nonce : ''
  const token = options.host === 'browser' ? options.token : ''
  const nonceAttr = webview ? ` nonce="${escapeAttr(nonce)}"` : ''
  const csp = webview
    ? `\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${escapeAttr(nonce)}'; script-src 'nonce-${escapeAttr(nonce)}';">`
    : ''
  const script = pageScript(kind)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">${csp}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE[kind]}</title>
<style${nonceAttr}>
${STYLE}</style>
</head>
<body data-host="${options.host}" data-token="${escapeAttr(token)}">
<div id="app"></div>
<script${nonceAttr}>
${inlineScript(script)}</script>
</body>
</html>
`
}
