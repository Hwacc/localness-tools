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
      return 'Access denied. The token may lack permission, or its owner may have left the team.'
    case 'not-found':
      return `Not found${detail}. Check localness.project.`
    case 'ambiguous-project':
      return 'The project name matches more than one project. Set localness.project to a project id.'
    case 'bad-request':
      return `The server rejected the request${detail}. A token that reaches several projects needs localness.project.`
    case 'network':
      return `Cannot reach ${baseUrl}. Check localness.baseUrl and your connection.`
    case 'server':
      return `The Localness server failed${detail}. Try again later.`
    case 'invalid-response':
      return 'The server answered with an unexpected response. The extension and server versions may not match.'
  }
}
