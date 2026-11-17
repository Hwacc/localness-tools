# @localness/sdk

Typed client, cache layer and change detection for the [Localness](https://github.com/Hwacc/localness) public `/api/v1`.

- Node >= 18 and the VS Code extension host; no browser-only APIs.
- ESM and CJS builds, strict TypeScript types.
- Responses are validated with the zod schemas of [`@localness/contract`](https://www.npmjs.com/package/@localness/contract).

## Install

```sh
pnpm add @localness/sdk
```

## Client

```ts
import { createClient, LocalnessError } from '@localness/sdk'

const client = createClient({
  baseUrl: 'https://localness.example.com',
  token: process.env.LOCALNESS_TOKEN!, // personal access token, sent as a Bearer token
  project: 'web', // id or name; needed when the token reaches several projects
  client: 'my-tool/1.0.0', // optional; see below
})

const { projects } = await client.projects()
const meta = await client.meta() // locales, sourceLocale, releases, coverage
const ja = await client.locale('ja', { release: 'v1', namespace: 'app' })
const { outdated } = await client.outdated()
const hits = await client.searchKeys('welcome', { limit: 20 })
// Keys whose source text (draft or published) equals each text, in order.
const { matches } = await client.match(['Welcome', 'Sign in'])

// Draft-visible per-key, per-locale state. Pages through the server limit for you.
const { keys, sourceLocale } = await client.keyStates({ locales: ['en', 'ja'] })
// Omit `locales` for every locale; `keys` narrows to named keys.
const [one] = (await client.keyStates({ keys: ['app.welcome'] })).keys

// Or stream page by page.
for await (const page of client.keyStatePages({
  locales: ['ja'],
  pageSize: 500,
})) {
  console.log(page.offset, page.keys.length, page.total)
}
```

Every method takes an optional `project` (on its scope or options) that overrides the client default.

`client` labels writes in the platform's key history. It is sent as `X-Localness-Client`, formatted `name/version`, with `; agent` appended when an AI agent drives the tool (for example `cli/0.1.0; agent`). It is a self-reported label, not a permission, and malformed values are recorded as unknown. Leave it unset in browsers: the custom header triggers a CORS preflight.

### Writes

Writes need a Read & write token. Translations and unnamed keys land in drafts; publishing stays in Localness.

```ts
// A named key publishes its source text; without `key` you get an unnamed draft.
await client.createKey({ key: 'app.welcome', sourceText: 'Welcome' })

// `expected` is the draft you read (`draftText ?? ''`); a mismatch throws `conflict`.
const { key } = await client.updateKey({
  key: 'app.welcome',
  locales: { ja: { text: 'ようこそ', expected: '' } },
})

// Spends AI quota.
const suggestion = await client.suggestKeyName('Welcome back')
```

When a draft changed since it was read, `draftConflictOf(error)` returns the locales that differ and the key's current state; nothing was written. A taken key name is a `conflict` with no draft data.

### Errors

Failures are thrown as `LocalnessError` with `code`, `status` (when the server answered), `serverMessage` and `data` (the server's error data, if any). Messages never contain the token or the query string.

| `code`              | When                                                    |
| ------------------- | ------------------------------------------------------- |
| `auth`              | 401: missing, invalid or revoked token                  |
| `forbidden`         | 403: read-only token, or the owner left the team        |
| `not-found`         | 404: unknown project, release, namespace or key         |
| `ambiguous-project` | 409 on reads: the project name matches several projects |
| `conflict`          | 409 on writes: a stale draft or a taken key name        |
| `bad-request`       | other 4xx, e.g. 400 when `project` is required          |
| `server`            | 5xx                                                     |
| `network`           | the request never got an answer (`cause` has the error) |
| `invalid-response`  | the body is not JSON or does not match the schema       |

```ts
try {
  await client.meta()
} catch (error) {
  if (error instanceof LocalnessError && error.code === 'auth') {
    // ask the user for a new token
  }
}
```

## Cache

A `CacheStore` holds `{ value, hash, fetchedAt }` entries. Two stores are included:

- `MemoryStore`: in process.
- `FileStore({ dir })`: one JSON file per key under `dir`. In a VS Code extension pass `context.globalStorageUri.fsPath`.

`createCachedResource` wraps any loader. The key comes from the base URL, project, locales, release and namespace, so different scopes never collide. The change check is a SHA-256 of the stable JSON of the value (sorted keys; the top-level `generatedAt` is ignored because it differs on every response).

```ts
import { FileStore, createCachedResource } from '@localness/sdk'

const store = new FileStore({ dir: storageDir })
const locales = ['en', 'ja']

const states = createCachedResource({
  store,
  key: {
    baseUrl: client.baseUrl,
    project: client.project,
    resource: 'keyStates',
    locales,
  },
  load: () => client.keyStates({ locales }),
})

const { changed } = await states.refresh() // fetch and store; did the content change?

// Stale-while-revalidate: the cached entry returns immediately,
// a refresh runs in the background. A cache miss awaits the fetch.
const entry = await states.load({
  maxAgeMs: 60_000, // skip the refresh while the entry is younger than this
  onRefresh: ({ changed }) => changed && rerender(),
  onError: (error) => console.warn(error),
})
render(entry.value)

await states.peek() // cache only, never the network
await states.clear()
```

Concurrent `refresh()` calls share one request. `contentHash(value)`, `stableStringify(value)` and `cacheKey(parts)` are exported for custom caching.

## Locale file sync (`@localness/sdk/sync`)

The core of `@localness/cli`, Node only. It reads `localness.config.json`, compares local locale JSON files with the project three ways (local, platform, and the base: the last text both agreed on, kept in `.localness/base.json`), and plans writes in both directions.

```ts
import { createClient } from '@localness/sdk'
import {
  applyPull,
  applyPush,
  checkPlan,
  compareLocaleFiles,
  findConfigFile,
  loadConfig,
  planPull,
  planPush,
  PULL_KINDS,
  PUSH_KINDS,
  readBase,
  recordPull,
  recordPush,
  requireFiles,
  writeBase,
} from '@localness/sdk/sync'

const loaded = await loadConfig((await findConfigFile(process.cwd()))!)
const { baseUrl, project } = loaded.config
const client = createClient({ baseUrl, project, token })

const comparison = await compareLocaleFiles(loaded, client, { locales: ['ja'] })
// entries: { locale, key, kind, local, platform, draft, base, onPlatform }

const files = planPull(comparison, {
  format: requireFiles(loaded).format,
  kinds: PULL_KINDS,
  prune: false,
})
await applyPull(files)
await writeBase(loaded, recordPull(comparison, files))

const plan = planPush(loaded, comparison, { kinds: PUSH_KINDS })
const check = await checkPlan(client, plan)
if (!check.expired && check.stale.length === 0) {
  const result = await applyPush(client, plan, check)
  const base = await readBase(loaded)
  await writeBase(loaded, recordPush(base, plan, result))
}
```

| Kind               | Meaning                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `platform-added`   | The project has text the file lacks.                                    |
| `platform-changed` | The project changed since the base; the file did not.                   |
| `platform-deleted` | The key left the project; the file still has the base text.             |
| `local-added`      | The file has text the project lacks (or the key is not in the project). |
| `local-changed`    | The file changed since the base; the project did not.                   |
| `local-deleted`    | The file removed a key the project still has unchanged.                 |
| `different`        | Text differs and there is no base to tell which side changed.           |
| `conflict`         | Both sides changed, or the file would overwrite someone else's draft.   |
| `pending-publish`  | The file matches the project's unpublished draft.                       |

`PULL_KINDS` / `SYNC_PULL_KINDS` / `FORCED_PULL_KINDS` and `PUSH_KINDS` / `FORCED_PUSH_KINDS` are the kind sets the CLI uses. Push plans live in `.localness/plans/`, expire after an hour, hold at most 200 keys and are bound to the base URL, project and `content`. `prunePlans` deletes expired ones (the CLI runs it on `push`, `sync` and `apply` without an id). `applyPush` creates new keys, then updates drafts with the draft text read by `checkPlan` as `expected`, and stops at the first error. `diffLocaleTexts`, `fetchPlatformTexts`, `readLocalFiles` and `parseConfig` are exported for other flows. Keys of unnamed drafts are skipped; `content: "draft"` compares draft text instead of published text.

## Testing

Pass `fetch` to `createClient` to supply your own implementation, for example a mock.

## Contract types

Response types come from `@localness/contract` (>= 0.4.1, which includes `GET /api/v1/keys/states` and `meta.sourceLocale`) and are re-exported.
