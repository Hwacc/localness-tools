import { isAbsolute, relative, sep } from 'node:path'

/** Whether `path` is `dir` or inside it. */
export function isInside(dir: string, path: string) {
  const rel = relative(dir, path)
  return rel.split(sep)[0] !== '..' && !isAbsolute(rel)
}

export function sameFile(a: string, b: string) {
  return relative(a, b) === ''
}

/** The config to switch to when a workspace file opens: none when it has no config above it, or uses the active one. */
export function configToFollow(
  found: string | undefined,
  active: string | undefined,
) {
  return found && !(active && sameFile(found, active)) ? found : undefined
}

/** Whether a change to the config file `changed` affects the active config. */
export function affectsActiveConfig(
  changed: string,
  active: string | undefined,
) {
  return !active || sameFile(changed, active)
}

/** `apps/web` for `apps/web/localness.config.json`; `fallback` for a config at the workspace root. */
export function configDirLabel(relativePath: string, fallback: string) {
  return relativePath.split(/[\\/]/).slice(0, -1).join('/') || fallback
}
