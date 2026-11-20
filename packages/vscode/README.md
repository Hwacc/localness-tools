# Localness for VS Code

Shows Localness translation keys where you use them, edits their translations and syncs the locale files. Requires a Localness personal access token.

## Features

- **Hover**: source and display-locale text with state badges (`Published`, `Edited`, `Outdated`, `Not published`), plus copy, open in Localness and edit.
- **Inline hints**: show the translation after the key or in place of it (`Localness: Switch inline hint mode`). Known keys are underlined.
- **Diagnostics**: warns on keys missing from remote. Keys only in the locale files count as known and can be pushed from the hover.
- **Edit translations**: saved as drafts; publish them in Localness. Concurrent edits are never overwritten.
- **Extract hardcoded text**: turn a selected string into a key, reusing a key with the same text or naming a new one (checked against the key convention, with optional AI suggestions). The code is rewritten per `extractTemplates`.
- **Keys view**: keys by namespace with state icons; find usages, open the locale file, edit, copy, or push local-only keys. Filter by release.
- **Local Files view**: differences between the locale files and remote, with compare, pull and push. Extracted and edited keys are also written to the locale files, following `content` in `localness.config.json`.
- **Releases**: pick the release new keys are labelled with, and edit the labels of existing keys.
- **Search** (`Localness: Search keys`): by key name or source text.
- **Status bar**: display locale, release and local changes in one item, with quick switches.
- **Agent review**: a coding agent's `localness review` opens as an editor tab instead of the browser.

Editing, extracting and pushing need a Read & write token.

Only the source locale and the display locale are downloaded. Data is kept in memory and cached under the extension's global storage; the cache is shown immediately and refreshed in the background, when the window regains focus, and on `Localness: Refresh`. The cache can contain draft text.

## Terms

- **remote**: the texts of the configured project on the Localness instance.
- **local**: the locale files in the workspace.
- **project**: the Localness project named in `localness.config.json`.
- **Localness**: the product and the instance you sign in to.
- **locale**: a language, such as `en` or `ja`.

Identifiers such as view context values and the CLI's `--json` fields (`platform`, `onPlatform`, `platform-added` …) keep the name `platform`; it means remote.

## Getting started

1. Run **Localness: Sign in**. Enter the base URL (for example `https://localness.example.com`) and a personal access token. The token is stored in VS Code's SecretStorage, never in a file.
2. Pick a project if the token reaches more than one.

The extension only uses the signed-in token; it does not read `LOCALNESS_TOKEN` or `.env.local`, which belong to the CLI. Editing and extracting need a Read & write token.

Sign in writes the base URL and project to `localness.config.json` in the workspace folder. Commit it: the same file configures the `localness` CLI (`@localness/cli`), and `localness init` can create it. **Localness: Select project** updates it; edits to the file apply immediately.

```json
{
  "baseUrl": "https://localness.example.com",
  "project": "web"
}
```

The extension uses the nearest `localness.config.json` at or above the active file, else the one at or above the first workspace folder, so each package of a monorepo can point at its own project. Focusing something that is not a workspace file, or a file with no config above it, keeps the current config. The status bar tooltip shows which config is active; with several, the Keys and Local Files views show its folder and `Localness: Switch config` picks another. Diagnostics only cover files under the active config's folder.

## Project configuration (`localness.config.json`)

| Field                   | Default   | Description                                                                                 |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `baseUrl`               | required  | Localness instance URL.                                                                     |
| `project`               | none      | Project id or name. Missing: the token's only project.                                      |
| `keyPatterns`           | `[]`      | Extra regular expressions finding keys; the key is capture group 1.                         |
| `useDefaultKeyPatterns` | `true`    | Keep the built-in patterns alongside `keyPatterns`.                                         |
| `extractTemplates`      | see below | Code written by **Extract to Localness**, per site.                                         |
| `release`               | none      | Release that keys created by extract or push are labelled with; set it from the status bar. |
| `files`, `locales`, ... |           | Local locale files, shared with the CLI; see the `@localness/cli` README.                   |

`extractTemplates` overrides any of these; `{key}` is the key and `{attr}` the attribute name. An entry without `{key}` is ignored:

```json
{
  "extractTemplates": {
    "vueText": "{{ $t('{key}') }}",
    "vueAttr": ":{attr}=\"$t('{key}')\"",
    "vueExpr": "$t('{key}')",
    "jsxText": "{t('{key}')}",
    "jsxAttr": "{attr}={t('{key}')}",
    "script": "t('{key}')"
  }
}
```

## Settings

Personal display preferences stay in VS Code settings:

| Setting                         | Default                                                               | Description                                                       |
| ------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `localness.displayLocale`       | `""`                                                                  | Locale shown in hovers and hints. Empty: first non-source locale. |
| `localness.inlineHints`         | `"inline"`                                                            | `"inline"`, `"replace"` or `"off"`.                               |
| `localness.inlineHintStyle`     | `"inlay"`                                                             | `"inlay"`, `"dot"`, `"arrow"` or `"plain"`.                       |
| `localness.replaceRevealOn`     | `"line"`                                                              | Reveal replaced keys by cursor `"line"` or by `"cursor"` on key.  |
| `localness.inlineHintMaxLength` | `40`                                                                  | Truncation length of inline hints.                                |
| `localness.keyUnderline`        | `true`                                                                | Underline keys that exist in the project.                         |
| `localness.diagnostics`         | `true`                                                                | Warn about unknown keys.                                          |
| `localness.languages`           | `typescript, typescriptreact, javascript, javascriptreact, vue, html` | Language ids in which keys are recognised.                        |
| `localness.cliCommand`          | `"localness"`                                                         | How the Local Files view runs the CLI, e.g. `npx localness`.      |

## Key detection

Built-in patterns recognise `t('key')`, `$t('key')`, `this.$t('key')`, `i18n.t('key')`, `i18n.global.t('key')` and `<i18n-t keypath="key">`, with single, double or backtick quotes. Template literals containing `${}` and bound attributes (`:keypath`) are ignored as dynamic. Detection is regex based, not AST based.

Custom pattern example in `localness.config.json` (a `tr("key")` helper):

```json
{ "keyPatterns": ["\\btr\\(\"([^\"\\n]+)\"\\)"] }
```

## Namespaces

The Keys view groups keys by the namespaces the project declares (from `/api/v1/meta`). Names are relative to the project's key prefix: a key belongs to the namespace that what follows its prefix starts with, followed by one of `_ . - : /` (a key without the prefix is matched whole). Without declared namespaces keys group by their first segment after the prefix.

## Development

```sh
pnpm install
pnpm --filter localness-vscode build
```

Open the repository in VS Code and press F5 with the `packages/vscode` folder as the extension development path.
