import {
  reviewDocument,
  type ReviewPageHost,
  type ReviewPageKind,
} from './page/shell'

export type ReviewPageOptions = ReviewPageHost & {
  /** Which page to render. Defaults to the extract review. */
  kind?: ReviewPageKind
}

/** The review page, all inline. In a webview it talks to the extension instead of a server. */
export function reviewPage(options: ReviewPageOptions) {
  return reviewDocument(options, options.kind ?? 'extract')
}
