# Localness for VS Code

Shows Localness translation keys where you use them. Read-only; requires a Localness personal access token.

## Features

- **Hover** on a key: source text, display-locale text, state (`draft`, `published`, `outdated`, `unpublished`), release ids and an _Open in Localness_ link.
- **Inline hints**: the display-locale text after each key (`inline`, truncated, styled by `localness.inlineHintStyle`) or in place of the key (`replace`; the key reappears per `localness.replaceRevealOn`). Switch with `Localness: Switch inline hint mode`.
- **Key underline**: keys that exist in the project get a dotted underline.
- **Diagnostics**: a warning on keys that do not exist in the project (_Key not found in Localness_).
- **Keys view** (activity bar): keys grouped by namespace with state icons; click a key to open it in Localness.
- **Search** (`Localness: Search keys`): matches key names and source text, from the local cache first, then the server for larger result sets.
- **Status bar**: project and display locale; click to switch locale, refresh, select the project or sign in.

Only the source locale and the display locale are downloaded. Data is kept in memory and cached under the extension's global storage; the cache is shown immediately and refreshed in the background, when the window regains focus, and on `Localness: Refresh`. The cache can contain draft text.

## Getting started

1. Run **Localness: Sign in**. Enter the base URL (for example `https://localness.example.com`) and a personal access token. The token is stored in VS Code's SecretStorage, never in settings.
2. Pick a project if the token reaches more than one.

Commit the non-secret settings to `.vscode/settings.json`:

```json
{
  "localness.baseUrl": "https://localness.example.com",
  "localness.project": "web",
  "localness.displayLocale": "ja"
}
```

## Settings

| Setting                           | Default                                                               | Description                                                       |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `localness.baseUrl`               | `""`                                                                  | Localness instance URL.                                           |
| `localness.project`               | `""`                                                                  | Project id or name. Empty: pick from the token's projects.        |
| `localness.displayLocale`         | `""`                                                                  | Locale shown in hovers and hints. Empty: first non-source locale. |
| `localness.keyPatterns`           | `[]`                                                                  | Extra regular expressions; the key is capture group 1.            |
| `localness.useDefaultKeyPatterns` | `true`                                                                | Keep the built-in patterns alongside `keyPatterns`.               |
| `localness.inlineHints`           | `"inline"`                                                            | `"inline"`, `"replace"` or `"off"`.                               |
| `localness.inlineHintStyle`       | `"inlay"`                                                             | `"inlay"`, `"dot"`, `"arrow"` or `"plain"`.                       |
| `localness.replaceRevealOn`       | `"line"`                                                              | Reveal replaced keys by cursor `"line"` or by `"cursor"` on key.  |
| `localness.inlineHintMaxLength`   | `40`                                                                  | Truncation length of inline hints.                                |
| `localness.keyUnderline`          | `true`                                                                | Underline keys that exist in the project.                         |
| `localness.diagnostics`           | `true`                                                                | Warn about unknown keys.                                          |
| `localness.languages`             | `typescript, typescriptreact, javascript, javascriptreact, vue, html` | Language ids in which keys are recognised.                        |

## Key detection

Built-in patterns recognise `t('key')`, `$t('key')`, `this.$t('key')`, `i18n.t('key')`, `i18n.global.t('key')` and `<i18n-t keypath="key">`, with single, double or backtick quotes. Template literals containing `${}` and bound attributes (`:keypath`) are ignored as dynamic. Detection is regex based, not AST based.

Custom pattern example (a `tr("key")` helper):

```json
{ "localness.keyPatterns": ["\\btr\\(\"([^\"\\n]+)\"\\)"] }
```

## Namespaces

The Keys view groups keys by the namespaces the project declares (from `/api/v1/meta`). A key belongs to the namespace whose name it starts with, followed by one of `_ . - : /`. Without declared namespaces keys group by their first segment.

## Development

```sh
pnpm install
pnpm --filter localness-vscode build
```

Open the repository in VS Code and press F5 with the `packages/vscode` folder as the extension development path.
