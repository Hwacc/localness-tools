import { createTransport, normalizeBaseUrl, type FetchLike } from './http'
import {
  captureKeySearchSchema,
  deliveryBundleSchema,
  deliveryKeyStatesSchema,
  deliveryLocaleSchema,
  deliveryMetaSchema,
  deliveryOutdatedSchema,
  deliveryProjectsSchema,
  type CaptureKeySearch,
  type DeliveryBundle,
  type DeliveryKeyState,
  type DeliveryKeyStates,
  type DeliveryLocale,
  type DeliveryMeta,
  type DeliveryOutdated,
  type DeliveryProjects,
} from './schemas'

export const DEFAULT_KEY_STATES_PAGE_SIZE = 1000
export const MAX_KEY_STATES_PAGE_SIZE = 5000

export interface ClientOptions {
  baseUrl: string
  token: string
  /** Project id or name. Required by the server when the token reaches several projects. */
  project?: string | number
  fetch?: FetchLike
}

export interface Scope {
  /** Overrides the client's default project for this call. */
  project?: string | number
  release?: string | number
  namespace?: string
}

export interface SearchKeysOptions {
  project?: string | number
  limit?: number
  offset?: number
}

export interface KeyStatesOptions extends Scope {
  locales: readonly string[]
  /** Keys per request; clamped to the server maximum of 5000. */
  pageSize?: number
}

export interface KeyStatesResult {
  sourceLocale: string
  keys: DeliveryKeyState[]
  total: number
  generatedAt: string
}

export interface LocalnessClient {
  readonly baseUrl: string
  readonly project: string | number | undefined
  projects(): Promise<DeliveryProjects>
  meta(scope?: Scope): Promise<DeliveryMeta>
  locale(locale: string, scope?: Scope): Promise<DeliveryLocale>
  bundle(scope?: Scope): Promise<DeliveryBundle>
  outdated(scope?: Pick<Scope, 'project'>): Promise<DeliveryOutdated>
  searchKeys(q: string, options?: SearchKeysOptions): Promise<CaptureKeySearch>
  keyStates(options: KeyStatesOptions): Promise<KeyStatesResult>
  keyStatePages(options: KeyStatesOptions): AsyncGenerator<DeliveryKeyStates>
}

export function createClient(options: ClientOptions): LocalnessClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const transport = createTransport({ ...options, baseUrl })

  const { get } = transport

  function scoped(scope: Scope = {}) {
    return {
      project: scope.project ?? options.project,
      release: scope.release,
      namespace: scope.namespace,
    }
  }

  async function* keyStatePages(opts: KeyStatesOptions) {
    const limit = Math.min(
      Math.max(opts.pageSize ?? DEFAULT_KEY_STATES_PAGE_SIZE, 1),
      MAX_KEY_STATES_PAGE_SIZE,
    )
    const base = { ...scoped(opts), locales: opts.locales.join(',') }
    let offset = 0
    while (true) {
      const page = await get(
        '/keys/states',
        { ...base, offset, limit },
        deliveryKeyStatesSchema,
      )
      yield page
      offset += page.keys.length
      if (page.keys.length === 0 || offset >= page.total) return
    }
  }

  return {
    baseUrl,
    project: options.project,
    projects: () => get('/projects', {}, deliveryProjectsSchema),
    meta: (scope) => get('/meta', scoped(scope), deliveryMetaSchema),
    locale: (locale, scope) =>
      get(
        `/locales/${encodeURIComponent(locale)}`,
        scoped(scope),
        deliveryLocaleSchema,
      ),
    bundle: (scope) => get('/bundle', scoped(scope), deliveryBundleSchema),
    outdated: (scope) =>
      get(
        '/outdated',
        { project: scope?.project ?? options.project },
        deliveryOutdatedSchema,
      ),
    searchKeys: (q, opts = {}) =>
      get(
        '/keys/search',
        {
          q,
          project: opts.project ?? options.project,
          limit: opts.limit,
          offset: opts.offset,
        },
        captureKeySearchSchema,
      ),
    keyStatePages,
    async keyStates(opts) {
      const keys: DeliveryKeyState[] = []
      let first: DeliveryKeyStates | undefined
      for await (const page of keyStatePages(opts)) {
        first ??= page
        keys.push(...page.keys)
      }
      return {
        sourceLocale: first?.sourceLocale ?? '',
        keys,
        total: first?.total ?? 0,
        generatedAt: first?.generatedAt ?? '',
      }
    },
  }
}
