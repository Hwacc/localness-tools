/** Posted by the review page. `id` is set only on calls that wait for `{id, value}`. */
export type PageMessage =
  | { type: 'api'; id: number; method: string; path: string; body?: unknown }
  | { type: 'confirm'; id: number; message: string }
  | { type: 'alert'; message: string }
  | { type: 'open'; index: number }
  | { type: 'openLocation'; path: string; key: string }
