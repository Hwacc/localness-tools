import { parseArgs } from 'node:util'
import { LocalnessError } from '@localness/sdk'
import { version } from '../package.json'
import { runApply } from './apply'
import { runDiff } from './diff'
import { TOKEN_ENV } from './env'
import { runInit } from './init'
import { runPull } from './pull'
import { runPush } from './push'
import { EXIT_ERROR, OPTIONS, type CliIo } from './shared'
import { runSuggestName } from './suggest-name'
import { runSync } from './sync'

const HELP = `localness ${version}: sync locale JSON files with a Localness project

Usage: localness <command> [options]

Commands:
  init                 Find the repository's locale files and write localness.config.json
  diff                 Compare the locale files with the project (exit 1 when they differ)
  pull                 Write the project's changes into the locale files
  push                 Plan sending local changes to the project; writes nothing
  apply <id>           Write a plan to the project (no id: list plans)
  sync                 pull the project's changes, then plan a push of local ones
  suggest-name <text>  Ask the project's AI for a key name; writes nothing

Options:
  --config <path>      Config file (default: nearest localness.config.json)
  --keys <a,b>         Only these keys; for pull and push, take that side even
                       when both changed
  --locales <en,ja>    Only these platform locales
  --prune              Also remove keys the project does not have (pull)
  --dry-run            Show what would happen (init, pull, push, sync)
  --json               Machine-readable output
  --base-url <url>     Localness instance URL (init)
  --project <name|id>  Project (init; default: the token's only project)
  --dir <path>         Locale directory, skipping detection (init)
  --pattern <pattern>  File pattern under --dir, e.g. {locale}.json (init)
  --format <format>    flat-json or nested-json (init)
  --force              Overwrite an existing config (init)
  -h, --help           Show this help
  -v, --version        Show the version

The token is ${TOKEN_ENV} from .env.local next to the config, else from the
environment. Reading needs a read token; apply and suggest-name need a
read & write token. pull, sync and apply keep .localness/ next to the config:
the last agreed text and pending plans, never committed.
`

function describe(error: unknown) {
  if (!(error instanceof LocalnessError)) {
    return error instanceof Error ? error.message : String(error)
  }
  const detail = error.serverMessage ? ` (${error.serverMessage})` : ''
  switch (error.code) {
    case 'auth':
      return `Authentication failed; check ${TOKEN_ENV}.`
    case 'forbidden':
      return `The token may not do this${detail}; ${TOKEN_ENV} needs a read & write token.`
    case 'ambiguous-project':
      return 'The project name matches more than one project; set "project" to its id.'
    case 'bad-request':
      return `The server rejected the request${detail}. A token that reaches several projects needs "project" in the config.`
    default:
      return `${error.message}${detail}`
  }
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
    })
    const [command, ...rest] = positionals
    if (values.version) {
      io.stdout(`${version}\n`)
      return 0
    }
    if (values.help || !command) {
      io.stdout(HELP)
      return values.help ? 0 : EXIT_ERROR
    }
    if (command === 'suggest-name') {
      return await runSuggestName(io, values, rest.join(' '))
    }
    const allowed = command === 'apply' ? 1 : 0
    if (rest.length > allowed) {
      throw new Error(`Unexpected argument: ${rest[allowed]}`)
    }
    switch (command) {
      case 'init':
        return await runInit(io, values)
      case 'diff':
        return await runDiff(io, values)
      case 'pull':
        return await runPull(io, values)
      case 'push':
        return await runPush(io, values)
      case 'apply':
        return await runApply(io, values, rest[0])
      case 'sync':
        return await runSync(io, values)
      default:
        throw new Error(`Unknown command: ${command}. Run "localness --help".`)
    }
  } catch (error) {
    io.stderr(`localness: ${describe(error)}\n`)
    return EXIT_ERROR
  }
}
