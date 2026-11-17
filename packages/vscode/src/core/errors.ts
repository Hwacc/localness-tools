import { LocalnessError } from '@localness/sdk'

export function describeError(error: unknown, baseUrl: string): string {
  if (!(error instanceof LocalnessError)) {
    return error instanceof Error ? error.message : String(error)
  }
  const detail = error.serverMessage ? ` (${error.serverMessage})` : ''
  switch (error.code) {
    case 'auth':
      return 'Authentication failed. Run "Localness: Sign in" with a valid token.'
    case 'forbidden':
      if (error.serverMessage?.includes('read-only')) {
        return 'This token is read-only. Sign in with a Read & write token to edit keys.'
      }
      return 'Access denied. The token may lack permission, or its owner may have left the team.'
    case 'not-found':
      return `Not found${detail}. Check "project" in localness.config.json.`
    case 'ambiguous-project':
      return 'The project name matches more than one project. Set "project" in localness.config.json to a project id.'
    case 'conflict':
      return `Conflict${detail}.`
    case 'bad-request':
      return `The server rejected the request${detail}. A token that reaches several projects needs "project" in localness.config.json.`
    case 'network':
      return `Cannot reach ${baseUrl}. Check "baseUrl" in localness.config.json and your connection.`
    case 'server':
      return `The Localness server failed${detail}. Try again later.`
    case 'invalid-response':
      return 'The server answered with an unexpected response. The extension and server versions may not match.'
  }
}
