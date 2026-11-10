export const errorCodes = [
  'auth',
  'forbidden',
  'not-found',
  'ambiguous-project',
  'bad-request',
  'server',
  'network',
  'invalid-response',
] as const

export type LocalnessErrorCode = (typeof errorCodes)[number]

export interface LocalnessErrorInit {
  status?: number
  serverMessage?: string
  cause?: unknown
}

export class LocalnessError extends Error {
  readonly code: LocalnessErrorCode
  readonly status: number | undefined
  readonly serverMessage: string | undefined

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
  }
}

export function codeForStatus(status: number): LocalnessErrorCode {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  if (status === 409) return 'ambiguous-project'
  if (status >= 500) return 'server'
  return 'bad-request'
}
