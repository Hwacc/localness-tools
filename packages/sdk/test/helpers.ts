import { vi } from 'vitest'
import type { FetchLike } from '../src'

export const BASE_URL = 'https://localness.example.com'
export const TOKEN = 'lnk_fake_token_for_tests'

export interface MockCall {
  url: URL
  method: string
  headers: Record<string, string>
  body: unknown
}

export type MockReply =
  | { status?: number; body: unknown }
  | { throws: Error }
  | { rawBody: string; status?: number }

export function mockFetch(reply: MockReply | ((call: MockCall) => MockReply)) {
  const calls: MockCall[] = []
  const fn = vi.fn<FetchLike>(async (input, init) => {
    const call = {
      url: new URL(input),
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    }
    calls.push(call)
    const r = typeof reply === 'function' ? reply(call) : reply
    if ('throws' in r) throw r.throws
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () =>
        'rawBody' in r ? JSON.parse(r.rawBody) : (r.body as unknown),
    }
  })
  return { fetch: fn, calls }
}
