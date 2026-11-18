import {
  LocalnessError,
  findRelease,
  type LocalnessClient,
  type ProjectRelease,
} from '@localness/sdk'
import { writeConfigFields, type LoadedConfig } from '@localness/sdk/sync'
import { loadProject, plural, type CliIo, type CliValues } from './shared'

const USAGE = `Usage:
  localness releases                      List releases; * marks the config's
  localness releases use [name] | --none  Label new keys with a release, or none
  localness releases create <name> [--use]
  localness releases add <release> <key...> | --match <glob> [--yes]
  localness releases remove <release> <key...> | --match <glob> [--yes]`

/** `*` matches any run of characters, `?` one; the whole key must match. */
export function globToRegExp(glob: string) {
  const source = glob
    .split('')
    .map((char) =>
      char === '*'
        ? '.*'
        : char === '?'
          ? '.'
          : char.replace(/[.+^${}()|[\]\\]/g, '\\$&'),
    )
    .join('')
  return new RegExp(`^${source}$`)
}

async function releasesOf(client: LocalnessClient) {
  const meta = await client.meta()
  return {
    releases: [...meta.releases].sort((a, b) => a.sort - b.sort),
    sourceLocale: meta.sourceLocale,
  }
}

function requireRelease(releases: readonly ProjectRelease[], name: string) {
  const found = findRelease(releases, name)
  if (!found) {
    throw new Error(
      `The project has no release "${name}"; it has ${releases.map((release) => release.name).join(', ') || 'none'}.`,
    )
  }
  return found
}

async function choose(io: CliIo, releases: readonly ProjectRelease[]) {
  if (!io.prompt) {
    throw new Error('Pass a release name, or --none.\n' + USAGE)
  }
  releases.forEach((release, index) =>
    io.stdout(`  ${index + 1}. ${release.name}\n`),
  )
  io.stdout('  0. None\n')
  const answer = (await io.prompt('Release for new keys: ')).trim()
  const index = Number(answer)
  if (answer === '0') return null
  const picked = Number.isInteger(index) ? releases[index - 1] : undefined
  return picked ?? requireRelease(releases, answer)
}

async function use(
  io: CliIo,
  loaded: LoadedConfig,
  release: ProjectRelease | null,
  json: boolean | undefined,
) {
  await writeConfigFields(loaded.path, { release: release?.name })
  if (json) {
    io.stdout(`${JSON.stringify({ release: release?.name ?? null })}\n`)
  } else {
    io.stdout(
      release
        ? `New keys will be labelled ${release.name}.\n`
        : 'New keys will have no release.\n',
    )
  }
  return 0
}

async function label(
  io: CliIo,
  values: CliValues,
  client: LocalnessClient,
  mode: 'add' | 'remove',
  [name, ...keys]: string[],
) {
  if (!name || (keys.length === 0) === (values.match === undefined)) {
    throw new Error(`Name a release and either keys or --match.\n${USAGE}`)
  }
  const { releases, sourceLocale } = await releasesOf(client)
  const release = requireRelease(releases, name)
  const result = await client.keyStates({
    locales: sourceLocale ? [sourceLocale] : undefined,
    keys: keys.length > 0 ? keys : undefined,
  })
  const found = new Map(result.keys.map((state) => [state.key, state]))
  const missing = keys.filter((key) => !found.has(key))
  if (missing.length > 0) {
    throw new Error(`The project has no key ${missing.join(', ')}.`)
  }
  const pattern = values.match === undefined ? null : globToRegExp(values.match)
  const id = Number(release.id)
  const targets = (
    pattern
      ? result.keys.filter((state) => pattern.test(state.key))
      : keys.map((key) => found.get(key)!)
  ).filter((state) => state.releaseIds.includes(id) === (mode === 'remove'))
  const verb = mode === 'add' ? 'Label' : 'Unlabel'
  if (targets.length === 0) {
    io.stdout('Nothing to change.\n')
    return 0
  }
  if (pattern && !values.yes) {
    io.stdout(
      `${verb} ${plural(targets.length, 'key')} ${mode === 'add' ? 'with' : 'from'} ${release.name}:\n`,
    )
    for (const state of targets) io.stdout(`  ${state.key}\n`)
    const answer = io.prompt ? await io.prompt('Proceed? [y/N] ') : ''
    if (!/^y(es)?$/i.test(answer.trim())) {
      io.stdout('Nothing changed; pass --yes to skip this question.\n')
      return 0
    }
  }
  const { changed } = await client.setReleaseMembership({
    releaseId: id,
    keyIds: targets.map((state) => state.id),
    mode,
  })
  if (values.json) {
    io.stdout(
      `${JSON.stringify({ release: release.name, mode, keys: targets.map((state) => state.key), changed }, null, 2)}\n`,
    )
  } else {
    io.stdout(
      `${verb}led ${plural(changed, 'key')} ${mode === 'add' ? 'with' : 'from'} ${release.name}.\n`,
    )
  }
  return 0
}

export async function runReleases(
  io: CliIo,
  values: CliValues,
  [action = 'list', ...args]: string[],
) {
  const { client, loaded } = await loadProject(io, values)
  const current = loaded.config.release
  switch (action) {
    case 'list': {
      const { releases } = await releasesOf(client)
      if (values.json) {
        io.stdout(
          `${JSON.stringify({ current: current ?? null, releases }, null, 2)}\n`,
        )
      } else if (releases.length === 0) {
        io.stdout('The project has no releases.\n')
      } else {
        const mark = current && findRelease(releases, current)
        for (const release of releases) {
          io.stdout(`${release === mark ? '*' : ' '} ${release.name}\n`)
        }
        if (current && !mark) {
          io.stdout(`The config names "${current}", which is not one.\n`)
        }
      }
      return 0
    }
    case 'use': {
      if (values.none) return use(io, loaded, null, values.json)
      const { releases } = await releasesOf(client)
      const release = args[0]
        ? requireRelease(releases, args[0])
        : await choose(io, releases)
      return use(io, loaded, release, values.json)
    }
    case 'create': {
      const name = args[0]?.trim()
      if (!name) throw new Error(`Name the release.\n${USAGE}`)
      const release = await client.createRelease(name).catch((error) => {
        if (error instanceof LocalnessError && error.code === 'forbidden') {
          throw new Error('Only project owners can create releases.')
        }
        throw error
      })
      if (values.use) {
        await writeConfigFields(loaded.path, { release: release.name })
      }
      io.stdout(
        values.json
          ? `${JSON.stringify({ ...release, used: values.use ?? false }, null, 2)}\n`
          : `Created release ${release.name}${values.use ? '; new keys will be labelled with it' : ''}.\n`,
      )
      return 0
    }
    case 'add':
    case 'remove':
      return label(io, values, client, action, args)
    default:
      throw new Error(`Unknown releases action: ${action}.\n${USAGE}`)
  }
}
