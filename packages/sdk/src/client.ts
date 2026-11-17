import { LocalnessError } from './errors'
import { createTransport, normalizeBaseUrl, type FetchLike } from './http'
import {
  captureKeySearchSchema,
  captureMatchSchema,
  deliveryBundleSchema,
  deliveryKeyStatesSchema,
  deliveryLocaleSchema,
  deliveryMetaSchema,
  deliveryOutdatedSchema,
  deliveryProjectsSchema,
  keyDraftConflictSchema,
  keyNameSuggestionSchema,
  keyWriteResultSchema,
  type CaptureKeySearch,
  type CaptureMatch,
  type DeliveryBundle,
  type DeliveryKeyState,
  type DeliveryKeyStates,
  type DeliveryLocale,
  type DeliveryMeta,
  type DeliveryOutdated,
  type DeliveryProjects,
  type KeyDraftConflict,
  type KeyNameSuggestion,
  type KeyWriteResult,
} from './schemas'

export const DEFAULT_KEY_STATES_PAGE_SIZE = 1000
export const MAX_KEY_STATES_PAGE_SIZE = 5000

export interface ClientOptions {
  baseUrl: string
  token: string
  /** Project id or name. Required by the server when the token reaches several projects. */
  project?: string | number
  /**
   * The tool behind the requests, `name/version` with an optional `; agent`
   * (`cli/0.1.0; agent`). The platform shows it beside writes in a key's
   * history; it is a label, not a permission. Leave it unset in browsers: the
   * custom header needs CORS approval.
   */
  client?: string
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
  /** Omit for every project locale. */
  locales?: readonly string[]
  /** Only these key names; unknown names are left out. */
  keys?: readonly string[]
  /** Keys per request; clamped to the server maximum of 5000. */
  pageSize?: number
}

export interface KeyStatesResult {
  sourceLocale: string
  keys: DeliveryKeyState[]
  total: number
  generatedAt: string
}

export type WriteScope = Pick<Scope, 'project'>

export interface CreateKeyInput {
  /** Omit to get the text's `__unnamed_` placeholder, a draft named later. A named key publishes its source text. */
  key?: string
  sourceText: string
}

export interface UpdateKeyInput {
  key: string
  /** Per locale: the new draft and the draft last read (`''` when there was none). */
  locales: Record<string, { text: string; expected: string }>
}

/** The current state behind a `conflict` from `updateKey`, or undefined for any other error. */
export function draftConflictOf(error: unknown): KeyDraftConflict | undefined {
  if (!(error instanceof LocalnessError) || error.code !== 'conflict') {
    return undefined
  }
  const parsed = keyDraftConflictSchema.safeParse(error.data)
  return parsed.success ? parsed.data : undefined
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
  /** Keys whose source text, draft or published, equals each text (whitespace-normalized). One entry per text, in order. */
  match(texts: readonly string[], scope?: WriteScope): Promise<CaptureMatch>
  keyStates(options: KeyStatesOptions): Promise<KeyStatesResult>
  keyStatePages(options: KeyStatesOptions): AsyncGenerator<DeliveryKeyStates>
  /** Write token. A taken name is a `conflict`. */
  createKey(input: CreateKeyInput, scope?: WriteScope): Promise<KeyWriteResult>
  /** Write token. Edits drafts only; a stale `expected` is a `conflict`, see `draftConflictOf`. */
  updateKey(input: UpdateKeyInput, scope?: WriteScope): Promise<KeyWriteResult>
  /** Write token; spends the project's AI quota and writes nothing. */
  suggestKeyName(
    sourceText: string,
    scope?: WriteScope,
  ): Promise<KeyNameSuggestion>
}

export function createClient(options: ClientOptions): LocalnessClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const transport = createTransport({ ...options, baseUrl })

  const { get, send } = transport
  const writeQuery = (scope?: WriteScope) => ({
    project: scope?.project ?? options.project,
  })

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
    const base = {
      ...scoped(opts),
      locales: opts.locales?.join(','),
      keys: opts.keys?.join(','),
    }
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
    match: (texts, scope) =>
      send('POST', '/match', writeQuery(scope), { texts }, captureMatchSchema),
    keyStatePages,
    createKey: (input, scope) =>
      send('POST', '/keys', writeQuery(scope), input, keyWriteResultSchema),
    updateKey: (input, scope) =>
      send('PATCH', '/keys', writeQuery(scope), input, keyWriteResultSchema),
    suggestKeyName: (sourceText, scope) =>
      send(
        'POST',
        '/keys/suggest-name',
        writeQuery(scope),
        { sourceText },
        keyNameSuggestionSchema,
      ),
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
