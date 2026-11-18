# Localness for VS Code

Shows Localness translation keys where you use them. Read-only; requires a Localness personal access token.

## Features

- **Hover** on a key: one section per locale (the source, then the display locale) with its text, a state badge (`Published`, `Edited`, `Outdated`, `Not published`) and an edit button; an edited locale also shows its published text. The icons next to the key copy it and open it in Localness; the footer edits any other locale.
- **Edit translations** (`Localness: Edit translation`, the hover buttons, or the pencil in the Keys view): edits any locale of the key under the cursor. The key is reloaded first so the edit starts from the current draft. Edits are saved as drafts; publish them in Localness. If someone changed the draft meanwhile, nothing is overwritten until you edit again. Needs a Read & write token; multi-line texts open in Localness.
- **Extract hardcoded text** (`Localness: Extract to Localness`, the editor context menu, or the lightbulb on a selection): select a string (with or without its quotes) or the text between tags. Keys with the same source text are offered for reuse; otherwise name a new key (the sparkle button asks AI for a name, leave it empty for an unnamed draft). The selection is then replaced per `extractTemplates` in `localness.config.json`: Vue text, static attributes (bound as `:attr`), template expressions, JSX text and attributes, and script strings. A named key is published; an unnamed one stays a draft that the app shows as its key name until it is named and published in Localness. Strings with `${…}` are not supported yet. Needs a Read & write token.
- **Inline hints**: the display-locale text after each key (`inline`, truncated, styled by `localness.inlineHintStyle`) or in place of the key (`replace`; the key reappears per `localness.replaceRevealOn`). Switch with `Localness: Switch inline hint mode`.
- **Key underline**: keys that exist in the project get a dotted underline.
- **Diagnostics**: a warning on keys that do not exist in the project (_Key not found in Localness_).
- **Keys view** (activity bar): keys grouped by namespace with state icons. Click a key to find where the code uses it: one usage opens directly, several open a list that previews each. With `files` configured, the file button opens the display locale's file at the key (the source locale's when the key is not there yet). The context menu also opens the key in Localness, edits a translation and copies the key.
- **Search** (`Localness: Search keys`): matches key names and source text, from the local cache first, then the server for larger result sets.
- **Releases**: the status bar menu's Release entry picks the release that keys created by **Extract to Localness** and push are labelled with (stored as `release` in `localness.config.json`); project owners can create one there. **Edit releases…** (hover link, or the Keys view context menu on keys, namespaces or a multi-selection) adds and removes release labels on existing keys; a release on only some of the selected keys stays as it is unless selected. The Keys view's filter button shows one release's keys or keys without one.
- **Status bar**: one item showing the display locale, the release for new keys and the number of local changes; hover it for links that switch the locale, change the release, review or push changes. Click it for a menu that switches the display locale and hint mode in one step; its title buttons search, refresh, and open project and account actions.
- **Locale files** (when `localness.config.json` has `files`): after an extraction, the key is written to the local locale files, keeping local changes; after an edit, that locale's text is written even over a local change. What is written follows `content` (`published` by default, so a draft edit waits for its publish).
- **Local Files view** (activity bar): what differs between the locale files and the project, grouped by kind (new, changed or removed in the project, local changes, conflicts, waiting for publish), with the count as a badge and in the Localness status bar item. Click an entry to compare both texts; inline buttons open the locale file at the key, pull the project's text (asking before replacing a local change) and push the local text (after a confirmation listing what will be created and which drafts written; needs a Read & write token). Pushed translations are drafts until published in Localness. The title bar pulls every project change and pushes every local change; its terminal button runs the CLI (`localness.cliCommand`) for reviewed push plans.

Only the source locale and the display locale are downloaded. Data is kept in memory and cached under the extension's global storage; the cache is shown immediately and refreshed in the background, when the window regains focus, and on `Localness: Refresh`. The cache can contain draft text.

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

The extension uses the nearest `localness.config.json` at or above the active file, else the one at or above the first workspace folder, so each package of a monorepo can point at its own project.

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

The Keys view groups keys by the namespaces the project declares (from `/api/v1/meta`). A key belongs to the namespace whose name it starts with, followed by one of `_ . - : /`. Without declared namespaces keys group by their first segment.

## Development

```sh
pnpm install
pnpm --filter localness-vscode build
```

Open the repository in VS Code and press F5 with the `packages/vscode` folder as the extension development path.
