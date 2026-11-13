import * as vscode from 'vscode'
import {
  FileStore,
  createCachedResource,
  createClient,
  type LocalnessClient,
} from '@localness/sdk'
import { buildProjectData, resolveLocales, type ProjectData } from './core/data'
import { describeError } from './core/errors'
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

export class DataController implements vscode.Disposable {
  readonly #changed = new vscode.EventEmitter<void>()
  readonly onDidChange = this.#changed.event
  readonly #store: FileStore
  #generation = 0
  #status: Status = { kind: 'unconfigured', message: 'Not configured' }
  #data: ProjectData | undefined
  #client: LocalnessClient | undefined

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

  async reload(force = false) {
    const generation = ++this.#generation
    const settings = readSettings()
    const stale = () => generation !== this.#generation
    const fail = (error: unknown) => {
      if (stale()) return
      this.#set({
        kind: 'error',
        message: describeError(error, settings.baseUrl),
      })
    }

    if (!settings.baseUrl) {
      this.#client = undefined
      this.#data = undefined
      this.#set({ kind: 'unconfigured', message: 'Set localness.baseUrl' })
      return
    }
    const token = await this.context.secrets.get(tokenKey(settings.baseUrl))
    if (stale()) return
    if (!token) {
      this.#client = undefined
      this.#data = undefined
      this.#set({ kind: 'unconfigured', message: 'Sign in to Localness' })
      return
    }

    if (!this.#data || force) this.#set({ kind: 'loading' })
    try {
      let project: string | number | undefined = settings.project || undefined
      if (project === undefined) {
        const { projects } = await createClient({
          baseUrl: settings.baseUrl,
          token,
        }).projects()
        if (stale()) return
        if (projects.length !== 1) {
          this.#client = undefined
          this.#data = undefined
          this.#set({ kind: 'unconfigured', message: 'Select a project' })
          return
        }
        project = projects[0]?.id
      }

      const client = createClient({ baseUrl: settings.baseUrl, token, project })
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

  dispose() {
    this.#generation += 1
    this.#changed.dispose()
  }
}
