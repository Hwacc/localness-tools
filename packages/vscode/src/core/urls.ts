export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function keyUrl(input: {
  baseUrl: string
  projectId: number
  keyId: number
}): string {
  const query = new URLSearchParams({
    project: String(input.projectId),
    key: String(input.keyId),
    scope: 'all',
  })
  return `${trimBaseUrl(input.baseUrl)}/translations?${query}`
}
