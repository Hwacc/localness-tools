# Localness extension playground

Plain fixture project for manually testing `packages/vscode` in an Extension Development Host. It is not part of the pnpm workspace and is ignored by Prettier. Everything uses placeholders: replace `https://localness.example.com` with your instance. No tokens are stored here.

## Launch

Build the extension first: `pnpm --filter localness-vscode build` (output: `packages/vscode/dist/extension.cjs`).

```sh
cursor --extensionDevelopmentPath=C:\my-workspace\localness-tools\packages\vscode C:\my-workspace\localness-tools\playground
code   --extensionDevelopmentPath=C:\my-workspace\localness-tools\packages\vscode C:\my-workspace\localness-tools\playground
```

Or open `packages/vscode` in the editor and press **F5** with "Run Extension on playground" (`packages/vscode/.vscode/launch.json`; it runs the build first). The workspace settings are in `playground/.vscode/settings.json` (base URL, project `playground`, display locale `zh-CN`, inline hints and diagnostics on). Then run **Localness: Sign in** and paste a read token.

## Platform setup

1. Create a project named `playground` with locales `en`, `zh-CN`, `ja`, `de`; source locale `en`.
2. Declare the namespaces `auth`, `cart`, `settings` (optional: also `settings.demo` to see longest-match grouping).
3. As Project Owner open Translations, then **Import**. Select the four files in `playground/seed/`, map each to its locale, review, import. Import publishes everything immediately, so after this all keys are `published` (or `unpublished` where a locale has no text).
4. Create a read-only personal access token and sign in from the extension.

## Seed contents

| Aspect | Keys |
| --- | --- |
| Fully translated | `welcome`, `app-title`, `ok`, `cancel`, `cart`, `auth.login.title`, `cart.total`, `settings.theme.dark` |
| Missing in some locales | `authorize` (not ja), `auth.login.hint` (not ja, de), `cart.promo.banner` (en, zh-CN only), `settings.danger.delete` (en only), `cart.demo.unpublished` (en only) |
| Empty strings (= no translation) | `settings.profile.nickname` in zh-CN and ja |
| Long text | `auth.session.expired`, `cart.promo.banner`, `cart.note.long` |
| Placeholders | `{name}`: `greeting.name`, `auth.login.error`; `{{count}}` / `{{amount}}`: `auth.login.error`, `cart.total`; ICU plural: `cart.items.count` |
| HTML | `auth/terms`, `cart_empty_html` |
| Emoji | `cart.checkout.done` |
| RTL / CJK | `settings.language.arabic`, `settings.language.hebrew`, `settings.profile.bio` |
| Namespaces | `auth` (`.` `_` `-` `:` `/` separators), `cart`, `settings`; ungrouped: `welcome`, `app-title`, `ok`, `cancel`, `greeting.name`, `authorize`, and `cart` (equals a namespace name) |
| Manual-state keys | `settings.demo.draft`, `settings.demo.outdated`, `cart.demo.unpublished` |

The import preview will warn that both `{name}` and `{{name}}` styles appear; that is intended.

## States the seed cannot create

- **draft**: in Translations open `settings.demo.draft`, **Revert to draft**, optionally edit the zh-CN text. Hover shows `key is a draft`, and the inline hint shows the draft text. For a brand new draft key: **New translation** with key `cart.demo.new-draft` and a source text (it is referenced in `edge-cases.ts`; before this step it is a warning).
- **outdated**: open `settings.demo.outdated`, **Revert to draft**, change the English source text, publish again. The zh-CN, ja and de translations are now `outdated` (only published keys are flagged).
- **unpublished**: `cart.demo.unpublished` has no text in zh-CN, so the state is `unpublished`. Also `settings.profile.nickname` (empty in zh-CN) and `settings.danger.delete`.
- **release tag**: create a release such as `v1` in Releases, then attach keys (e.g. `welcome`, `cart.total`) through the Releases column in Translations, or select it in the Import dialog. Hover then lists `v1 (#id)`.

After each platform change run **Localness: Refresh**.

## Custom patterns (off by default)

`src/custom-pattern.ts` needs these extra patterns in the workspace settings. Add them when testing and remove afterwards:

```jsonc
"localness.keyPatterns": [
  "(?<![\\w$.])translate\\(\\s*'([^'\\\\\\n]+)'",
  "(?<![\\w$.])L\\(\\s*\"([^\"\\\\\\n]+)\""
]
```

Set `"localness.useDefaultKeyPatterns": false` to see only the custom ones.

## Expected results (display locale zh-CN)

Fixture lines carry `EXPECT: detected <key>` or `EXPECT: not-detected <key>` markers; `packages/vscode/test/playground.test.ts` checks them against the default patterns. `detected` means hover, hint and diagnostic come from the platform data:

| Case | Hover | Inline hint | Diagnostic |
| --- | --- | --- | --- |
| Key fully translated (`welcome`, `auth.login.title`, ...) | source + zh-CN text, state `published`, Releases none | zh-CN text | none |
| `settings.profile.nickname`, `settings.danger.delete`, `cart.demo.unpublished` | zh-CN `none`, state `unpublished` | `(no translation)` | none |
| `cart.promo.banner`, `cart.note.long`, `auth.session.expired` | long text | truncated to 40 chars with an ellipsis | none |
| `missing.key.not-in-seed`, `欢迎.未知`, `Hello world`, `cart.`, `comment.*` keys, `cart.demo.new-draft` (before creation) | no hover | none | warning `Key not found in Localness` |
| `cart.${kind}.total`, `${prefix}.title`, `variable.key`, `ternary.yes` | none | none | none (not recognised) |
| `$tc`, `te`, `vm.$t`, `i18n?.t`, `t<string>`, `t ('x')`, `:keypath`, `v-t`, `Trans i18nKey` | none | none | none (not recognised) |
| `settings.demo.draft` after Revert to draft | `key is a draft` | draft text | none |
| `settings.demo.outdated` after the source edit | state `outdated` | zh-CN text | none |
| Key in a comment or string that looks like a call (`comment.line.key`, `string.inside.double`, ...) | as for a normal key | shown | warning if not in seed |
| Several keys on one line (`basic.ts`, `LoginForm.tsx`) | per key | one hint after each closing quote | per key |
| Key with release attached | `Releases: v1 (#id)` | n/a | none |

Switch the display locale (**Localness: Switch display locale**) to `ja` or `de` to see the missing-translation states of `authorize`, `auth.login.hint`, `cart.promo.banner`.

The Keys tree should group by declared namespace in platform order: `auth`, `cart`, `settings`, then ungrouped keys (`cart` itself, `authorize`, `app-title`, `welcome`, `greeting.name`, `ok`, `cancel`).

## Extractor behaviours the fixtures expose

- Comments, JSDoc, HTML comments and string contents are not excluded: keys in them are detected and can raise warnings.
- `t('cart.' + x)` is detected as the key `cart.` (prefix of a concatenation) and warns as not found.
- Only `this.`, `i18n.` and `i18n.global.` prefixes are accepted: `vm.$t(...)`, `app.config.globalProperties.$t(...)`, `i18n?.t(...)` and `(this as any).t(...)` are not.
- Keys are not trimmed: `t(' x ')` is looked up with the spaces.
