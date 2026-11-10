import type { z } from 'zod/v4'
import { LocalnessError, codeForStatus } from './errors'

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export type Query = Record<string, string | number | undefined>

export interface TransportOptions {
  baseUrl: string
  token: string
  fetch?: FetchLike
}

export interface Transport {
  get<T>(path: string, query: Query, schema: z.ZodType<T>): Promise<T>
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function serverMessageOf(body: unknown, token: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  const text = [record.statusMessage, record.message].find(
    (value): value is string => typeof value === 'string' && value !== '',
  )
  return text?.split(token).join('***')
}

export function createTransport(options: TransportOptions): Transport {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const { token } = options
  const doFetch: FetchLike =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  return {
    async get(path, query, schema) {
      const params = new URLSearchParams()
      for (const [name, value] of Object.entries(query)) {
        if (value !== undefined) params.set(name, String(value))
      }
      const search = params.size > 0 ? `?${params}` : ''
      const label = `GET /api/v1${path}`

      let res
      try {
        res = await doFetch(`${baseUrl}/api/v1${path}${search}`, {
          method: 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
          },
        })
      } catch (cause) {
        throw new LocalnessError(
          'network',
          `${label} could not reach the server`,
          {
            cause,
          },
        )
      }

      let body: unknown
      try {
        body = await res.json()
      } catch (cause) {
        if (res.ok) {
          throw new LocalnessError(
            'invalid-response',
            `${label} returned a body that is not JSON`,
            { status: res.status, cause },
          )
        }
      }

      if (!res.ok) {
        const serverMessage = serverMessageOf(body, token)
        throw new LocalnessError(
          codeForStatus(res.status),
          `${label} failed with ${res.status}${serverMessage ? `: ${serverMessage}` : ''}`,
          { status: res.status, serverMessage },
        )
      }

      const parsed = schema.safeParse(body)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 3)
          .map(
            (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
          )
          .join('; ')
        throw new LocalnessError(
          'invalid-response',
          `${label} returned an unexpected shape (${issues})`,
          { status: res.status, cause: parsed.error },
        )
      }
      return parsed.data
    },
  }
}
