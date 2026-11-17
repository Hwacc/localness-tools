export const errorCodes = [
  'auth',
  'forbidden',
  'not-found',
  'ambiguous-project',
  'conflict',
  'bad-request',
  'server',
  'network',
  'invalid-response',
] as const

export type LocalnessErrorCode = (typeof errorCodes)[number]

export interface LocalnessErrorInit {
  status?: number
  serverMessage?: string
  /** The `data` of the server's error body, such as a draft conflict. */
  data?: unknown
  cause?: unknown
}

export class LocalnessError extends Error {
  readonly code: LocalnessErrorCode
  readonly status: number | undefined
  readonly serverMessage: string | undefined
  readonly data: unknown

  constructor(
    code: LocalnessErrorCode,
    message: string,
    init: LocalnessErrorInit = {},
  ) {
    super(message, { cause: init.cause })
    this.name = 'LocalnessError'
    this.code = code
    this.status = init.status
    this.serverMessage = init.serverMessage
    this.data = init.data
  }
}

/**
 * A 409 on a read is an ambiguous project name; on a write it is a conflict:
 * a draft changed since it was read, or a key name is taken. A write's project
 * is resolved the same way, but a client has read with it before writing.
 */
export function codeForStatus(
  status: number,
  write = false,
): LocalnessErrorCode {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409) return write ? 'conflict' : 'ambiguous-project'
  if (status >= 500) return 'server'
  return 'bad-request'
}
