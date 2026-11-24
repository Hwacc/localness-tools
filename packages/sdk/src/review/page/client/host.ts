import type { PageMessage } from '../messages'

interface VsCodeApi {
  postMessage(message: PageMessage): void
}

/** Injected by the webview host. Absent in a browser tab, so `typeof` must stay. */
declare const acquireVsCodeApi: (() => VsCodeApi) | undefined

interface PageReply {
  id: number
  value: unknown
}

export interface PageResponse {
  status: number
  body: unknown
}

export interface PageHost {
  place: 'tab' | 'panel'
  api(path: string, body?: unknown): Promise<PageResponse>
  confirm(message: string): Promise<boolean>
  alert(message: string): void
  open: ((row: { index: number }) => void) | null
  openLocation: ((path: string, key: string) => void) | null
}

type PageCall =
  | { type: 'api'; method: string; path: string; body?: unknown }
  | { type: 'confirm'; message: string }

export function apiError(body: unknown) {
  const error =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: unknown }).error
      : undefined
  return typeof error === 'string' ? error : String(error)
}

function withId(message: PageCall, id: number): PageMessage {
  switch (message.type) {
    case 'api':
      return {
        type: 'api',
        id,
        method: message.method,
        path: message.path,
        body: message.body,
      }
    case 'confirm':
      return { type: 'confirm', id, message: message.message }
    default: {
      const unhandled: never = message
      return unhandled
    }
  }
}

function browserHost(): PageHost {
  const token = document.body.dataset.token ?? ''
  return {
    place: 'tab',
    api: async (path, body) => {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'x-review-token': token,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, body: await response.json() }
    },
    confirm: (message) => Promise.resolve(globalThis.confirm(message)),
    alert: (message) => {
      globalThis.alert(message)
    },
    open: null,
    openLocation: null,
  }
}

function webviewHost(): PageHost {
  const acquire = acquireVsCodeApi
  if (!acquire) throw new Error('VS Code webview API is missing.')
  const vscode = acquire()
  const waiting = new Map<number, (value: unknown) => void>()
  let calls = 0
  window.addEventListener('message', (event: MessageEvent<PageReply>) => {
    const id = event.data?.id
    if (typeof id !== 'number') return
    const done = waiting.get(id)
    if (!done) return
    waiting.delete(id)
    done(event.data.value)
  })
  const call = (message: PageCall) =>
    new Promise<unknown>((done) => {
      const id = ++calls
      waiting.set(id, done)
      vscode.postMessage(withId(message, id))
    })
  return {
    place: 'panel',
    api: (path, body) =>
      call({
        type: 'api',
        method: body === undefined ? 'GET' : 'POST',
        path,
        body,
      }) as Promise<PageResponse>,
    confirm: async (message) =>
      Boolean(await call({ type: 'confirm', message })),
    alert: (message) => {
      vscode.postMessage({ type: 'alert', message })
    },
    open: (row) => {
      vscode.postMessage({ type: 'open', index: row.index })
    },
    openLocation: (path, key) => {
      vscode.postMessage({ type: 'openLocation', path, key })
    },
  }
}

export function reviewRoot() {
  const found = document.getElementById('app')
  if (!found) throw new Error('Review page is missing #app.')
  return found
}

export function pageHost(): PageHost {
  return typeof acquireVsCodeApi === 'function' ? webviewHost() : browserHost()
}
