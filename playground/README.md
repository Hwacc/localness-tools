# Localness extension playground

Plain fixture project for manually testing `packages/vscode` in an Extension Development Host. It is not part of the pnpm workspace and is ignored by Prettier. Everything uses placeholders: replace `https://localness.example.com` with your instance. No tokens are stored here.

## Launch

Build the extension first: `pnpm --filter localness-vscode build` (output: `packages/vscode/dist/extension.cjs`).

```sh
cursor --extensionDevelopmentPath=C:\my-workspace\localness-tools\packages\vscode C:\my-workspace\localness-tools\playground
code   --extensionDevelopmentPath=C:\my-workspace\localness-tools\packages\vscode C:\my-workspace\localness-tools\playground
```

Or open `packages/vscode` in the editor and press **F5** with "Run Extension on playground" (`packages/vscode/.vscode/launch.json`; it runs the build first). The base URL and project are in `playground/localness.config.json`; the display settings (display locale `zh-CN`, inline hints and diagnostics on) in `playground/.vscode/settings.json`. Then run **Localness: Sign in** and paste a token. The CLI does not use that sign-in; for `localness diff` / `pull` put `LOCALNESS_TOKEN=lnk_...` in `playground/.env.local` (gitignored).

## Platform setup

1. Create a project named `playground` with locales `en`, `zh-CN`, `ja`, `de`; source locale `en`.
2. Declare the namespaces `auth`, `cart`, `settings` (optional: also `settings.demo` to see longest-match grouping).
3. As Project Owner open Translations, then **Import**. Select the four files in `playground/seed/`, map each to its locale, review, import. Import publishes everything immediately, so after this all keys are `published` (or `unpublished` where a locale has no text).
4. Create a personal access token (Read & write to try editing and extracting) and sign in from the extension. For the CLI, put a token (Read only is enough) in `playground/.env.local`.

## CLI

`localness.config.json` points `files` at `src/locales/{locale}.json` (flat JSON; the seed mixes keys like `cart` and `cart.total`, which nested JSON cannot hold both of). These files are the CLI fixtures, not import data: they were pulled from the project, then edited so `localness diff` shows every kind of difference:

| File           | Change                                          | `diff` shows (no base yet)   |
| -------------- | ----------------------------------------------- | ---------------------------- |
| `en.json`      | `welcome` reworded, `ok` removed, `home.hero.title` and five `checkout*` keys added | `different`, `platform-added`, `local-added` |
| `zh-CN.json`   | `cart` reworded, `home.hero.title` added        | `different`, `local-added`   |
| `ja.json`      | `cancel` removed, `settings.profile.nickname` filled | `platform-added`, `local-added` |
| `de.json`      | none                                            | nothing                      |

The table holds while the project still has the seed text; edits made on the platform since then change what `diff` shows. `localness pull --dry-run` and `localness push --dry-run` list what would be written. `pull` and `sync` write the files and create `.localness/` (gitignored); restore with `git checkout src/locales` and delete `.localness/` afterwards. `localness apply <id>` writes drafts to the real project and needs a Read & write token.

## Extraction and key names

`src/extract/` holds components with hardcoded text for the agent to extract (`localness skill install --root .`, then ask the agent to extract text in `src/extract/`). Expected outcome against the seed:

| Text | Expected |
| --- | --- |
| `Cancel`, `Forgot password?`, `Nickname`, `Delete my account` (split over two lines) | reuse the single matching key |
| `Sign in` | several keys match; the agent picks one or asks |
| Spring sale banner | partial match of `cart.promo.banner`; review before reusing |
| `Order summary`, `Coupon`, `Place order`, `Display name`, `Profile updated.` and the rest | new keys following the project convention |
| `console` text, `className`, `data-testid`, URLs, track event names, existing `t()` calls | left alone |

`localness match --json "Sign in"` prints `matches`, the project `convention` and declared `namespaces`. Keys only in `en.json` count too, marked `local`: `localness match "Place order"` finds `checkout_place_order` before it is pushed. `Shipping address` finds `checkout_ShippingAddress`, which is off the suggested casing, so the agent should mention it.

The agent then opens the review page (`localness review start`): one row per text with reuse / new key / skip, live name checks, and `Approve`. Typing `checkout__close` as a new name shows a red convention error that blocks `Approve`; picking the local `checkout.apply_coupon` or typing `checkout_ShippingAddress` shows a yellow warning only. To try the page without an agent, write `{ "items": [{ "text": "Coupon", "file": "src/extract/CheckoutSummary.tsx", "line": 20, "key": "checkout_coupon" }] }` to `.localness/review-input.json`, run `node ../packages/cli/dist/cli.mjs review start .localness/review-input.json`, approve, then `... review wait <id>`.

The five `checkout*` keys in `en.json` exercise name validation for new keys. Prefix, charset and empty segments are errors that block a new key; separator, casing and depth are suggestions that only warn, so legacy names still push. `localness push --dry-run` (with `_` separator, snake_case, depth 4):

| Key | Result |
| --- | --- |
| `checkout_place_order` | created |
| `checkout.apply_coupon` | created, warns `separator` |
| `checkout_ShippingAddress` | created, warns `case` |
| `checkout_summary_free_shipping_note` | created, warns `depth` |
| `checkout__close` | blocked, `segment` |

The VS Code Sync view shows the same blocked keys and warnings in the push confirmation. Existing keys are never checked, so the seed's `.` keys pass.

To test a key prefix, set one in the platform project settings (e.g. `web`) and declare namespaces (`auth`, `cart`, `settings`, `checkout`), then **Localness: Refresh**. Namespaces are relative to the prefix, so unprefixed seed keys stay ungrouped, and every new key without `web_` is blocked with `prefix`.

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

`src/custom-pattern.ts` needs these extra patterns in `localness.config.json`. Add them when testing and remove afterwards:

```jsonc
"keyPatterns": [
  "(?<![\\w$.])translate\\(\\s*'([^'\\\\\\n]+)'",
  "(?<![\\w$.])L\\(\\s*\"([^\"\\\\\\n]+)\""
]
```

Set `"useDefaultKeyPatterns": false` to see only the custom ones.

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
