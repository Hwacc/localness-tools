/**
 * The `localness.config.json` text with `baseUrl` and `project` set. Other
 * fields and their order are kept; a missing file starts empty.
 */
export function withProject(
  source: string | undefined,
  baseUrl: string,
  project: string | number,
): string {
  const config: unknown = source === undefined ? {} : JSON.parse(source)
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('localness.config.json must contain a JSON object.')
  }
  return `${JSON.stringify({ ...config, baseUrl, project }, null, 2)}\n`
}
