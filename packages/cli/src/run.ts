import { parseArgs } from 'node:util'
import { LocalnessError } from '@localness/sdk'
import { version } from '../package.json'
import { runDiff } from './diff'
import { TOKEN_ENV } from './env'
import { runInit } from './init'
import { runPull } from './pull'
import { EXIT_ERROR, OPTIONS, type CliIo } from './shared'

const HELP = `localness ${version}: sync locale JSON files with a Localness project

Usage: localness <command> [options]

Commands:
  init     Find the repository's locale files and write localness.config.json
  diff     Compare the locale files with the project (exit 1 when they differ)
  pull     Write the project's text into the locale files

Options:
  --config <path>      Config file (default: nearest localness.config.json)
  --keys <a,b>         Only these keys (diff, pull)
  --locales <en,ja>    Only these platform locales (diff, pull)
  --prune              Also remove keys the project does not have (pull)
  --dry-run            Show what would be written (init, pull)
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
environment; a read token is enough.
`

function describe(error: unknown) {
  if (!(error instanceof LocalnessError)) {
    return error instanceof Error ? error.message : String(error)
  }
  const detail = error.serverMessage ? ` (${error.serverMessage})` : ''
  switch (error.code) {
    case 'auth':
      return `Authentication failed; check ${TOKEN_ENV}.`
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
    if (rest.length > 0) throw new Error(`Unexpected argument: ${rest[0]}`)
    switch (command) {
      case 'init':
        return await runInit(io, values)
      case 'diff':
        return await runDiff(io, values)
      case 'pull':
        return await runPull(io, values)
      default:
        throw new Error(`Unknown command: ${command}. Run "localness --help".`)
    }
  } catch (error) {
    io.stderr(`localness: ${describe(error)}\n`)
    return EXIT_ERROR
  }
}
