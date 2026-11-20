import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  affectsActiveConfig,
  configDirLabel,
  configToFollow,
  isInside,
} from '../src/core/configs'

const root = join('/', 'repo')
const web = join(root, 'apps', 'web', 'localness.config.json')
const admin = join(root, 'apps', 'admin', 'localness.config.json')

describe('configToFollow', () => {
  it('switches to the config above a file of another package', () => {
    expect(configToFollow(admin, web)).toBe(admin)
    expect(configToFollow(web, undefined)).toBe(web)
  })

  it('keeps the active config for its own files and for files with no config', () => {
    expect(configToFollow(web, web)).toBeUndefined()
    expect(configToFollow(undefined, web)).toBeUndefined()
  })
})

describe('affectsActiveConfig', () => {
  it('reloads only for the active config, or when none is active', () => {
    expect(affectsActiveConfig(web, web)).toBe(true)
    expect(affectsActiveConfig(admin, web)).toBe(false)
    expect(affectsActiveConfig(admin, undefined)).toBe(true)
  })
})

describe('isInside', () => {
  const dir = join(root, 'apps', 'web')

  it('accepts the folder and files below it', () => {
    expect(isInside(dir, dir)).toBe(true)
    expect(isInside(dir, join(dir, 'src', 'App.vue'))).toBe(true)
    expect(isInside(dir, join(dir, '..foo.ts'))).toBe(true)
  })

  it('rejects siblings and parents', () => {
    expect(isInside(dir, join(root, 'apps', 'admin', 'App.vue'))).toBe(false)
    expect(isInside(dir, join(root, 'apps', 'web2', 'App.vue'))).toBe(false)
    expect(isInside(dir, root)).toBe(false)
  })
})

describe('configDirLabel', () => {
  it('is the folder of the config, with / separators', () => {
    expect(configDirLabel('apps/web/localness.config.json', 'repo')).toBe(
      'apps/web',
    )
    expect(configDirLabel('apps\\web\\localness.config.json', 'repo')).toBe(
      'apps/web',
    )
  })

  it('falls back for a config at the workspace root', () => {
    expect(configDirLabel('localness.config.json', 'repo')).toBe('repo')
  })
})
