import { dirname } from 'node:path'
import * as vscode from 'vscode'
import {
  FileStore,
  createCachedResource,
  createClient,
  type DeliveryKeyState,
  type LocalnessClient,
} from '@localness/sdk'
import {
  findConfigFile,
  loadConfig,
  type LoadedConfig,
} from '@localness/sdk/sync'
import { buildProjectData, resolveLocales, type ProjectData } from './core/data'
import { describeError } from './core/errors'
import { buildIndex, replaceKeyState } from './core/keys'
import { trimBaseUrl } from './core/urls'
import { readSettings } from './settings'

export type Status =
  | { kind: 'unconfigured'; message: string }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

const FRESH_MS = 10_000

export function tokenKey(baseUrl: string) {
  return `localness.token:${trimBaseUrl(baseUrl)}`
}

/** The folder whose config applies: the active file's folder, else the first workspace folder. */
function configStart(): string | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri
  if (uri?.scheme === 'file' && vscode.workspace.getWorkspaceFolder(uri)) {
    return dirname(uri.fsPath)
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
}

export function findProjectConfig(): Promise<string | undefined> {
  const start = configStart()
  return start ? findConfigFile(start) : Promise.resolve(undefined)
}

export class DataController implements vscode.Disposable {
  readonly #changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.#changed.event
  readonly #store: FileStore
  #generation = 0
  #status: Status = { kind: 'unconfigured', message: 'Not configured' }
  #data: ProjectData | undefined
  #client: LocalnessClient | undefined
  #configPath: string | undefined
  #config: LoadedConfig | undefined

  constructor(private readonly context: vscode.ExtensionContext) {
    this.#store = new FileStore({ dir: context.globalStorageUri.fsPath })
  }

  get status() {
    return this.#status
  }

  get data() {
    return this.#data
  }

  get client() {
    return this.#client
  }

  /** The loaded `localness.config.json`, undefined when missing or invalid. */
  get config() {
    return this.#config
  }

  get baseUrl() {
    return this.#client?.baseUrl ?? this.#config?.config.baseUrl ?? ''
  }

  /** Reloads when the active file now falls under another config file. */
  async followEditor() {
    if ((await findProjectConfig()) !== this.#configPath) await this.reload()
  }

  #clear(status: Status) {
    this.#client = undefined
    this.#data = undefined
    this.#set(status)
  }

  async reload(force = false) {
    const generation = ++this.#generation
    const settings = readSettings()
    const stale = () => generation !== this.#generation

    let loaded: LoadedConfig | undefined
    try {
      this.#configPath = await findProjectConfig()
      loaded = this.#configPath ? await loadConfig(this.#configPath) : undefined
    } catch (error) {
      if (stale()) return
      this.#config = undefined
      this.#clear({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }
    if (stale()) return
    this.#config = loaded
    if (!loaded) {
      this.#clear({ kind: 'unconfigured', message: 'Sign in to set up' })
      return
    }

    const { baseUrl } = loaded.config
    const fail = (error: unknown) => {
      if (stale()) return
      this.#set({ kind: 'error', message: describeError(error, baseUrl) })
    }
    const token = await this.context.secrets.get(tokenKey(baseUrl))
    if (stale()) return
    if (!token) {
      this.#clear({ kind: 'unconfigured', message: 'Sign in to Localness' })
      return
    }

    if (!this.#data || force) this.#set({ kind: 'loading' })
    try {
      let project = loaded.config.project
      if (project === undefined) {
        const { projects } = await createClient({ baseUrl, token }).projects()
        if (stale()) return
        if (projects.length !== 1) {
          this.#clear({ kind: 'unconfigured', message: 'Select a project' })
          return
        }
        project = projects[0]?.id
      }

      const client = createClient({
        baseUrl,
        token,
        project,
        client: `vscode/${this.context.extension.packageJSON.version}`,
      })
      this.#client = client
      const base = { baseUrl: client.baseUrl, project }
      const maxAgeMs = force ? 0 : FRESH_MS
      const onError = fail
      const onRefresh = (result: { changed: boolean }) => {
        if (result.changed) void this.reload()
      }

      const metaResource = createCachedResource({
        store: this.#store,
        key: { ...base, resource: 'meta' },
        load: () => client.meta(),
      })
      const meta = force
        ? await metaResource.refresh()
        : await metaResource.load({ maxAgeMs, onRefresh, onError })
      if (stale()) return

      const locales = resolveLocales(meta.value, settings.displayLocale)
      const statesResource = createCachedResource({
        store: this.#store,
        key: { ...base, resource: 'keyStates', locales: locales.fetch },
        load: () => client.keyStates({ locales: locales.fetch }),
      })
      const states = force
        ? await statesResource.refresh()
        : await statesResource.load({ maxAgeMs, onRefresh, onError })
      if (stale()) return

      this.#data = buildProjectData(
        meta.value,
        states.value,
        locales,
        states.fetchedAt,
        loaded.config.release,
      )
      this.#set({ kind: 'ready' })
    } catch (error) {
      fail(error)
    }
  }

  #set(status: Status) {
    this.#status = status
    this.#changed.fire()
  }

  /** Puts a key the server just returned into the loaded data. */
  applyKeyState(state: DeliveryKeyState) {
    const data = this.#data
    if (!data) return
    const keys = replaceKeyState(data.keys, state)
    this.#data = { ...data, keys, index: buildIndex(keys) }
    this.#changed.fire()
  }

  dispose() {
    this.#generation += 1
    this.#changed.dispose()
  }
}
