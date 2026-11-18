# JSON shapes

- `diff --json`: `{ sourceLocale, locales, content, hasBase, files, differences: [{ locale, key, kind, local, platform, draft, base, onPlatform }] }`
- `push --json`: `{ id, path, expiresAt, sourceLocale, release, keys: [{ key, create, locales: { <locale>: { text, platform, draft } } }], blocked, leftOut }`; `id` is null when there is nothing to push; `release` is the name new keys get, or null.
- `apply <id> --json`: `{ id, written: [{ key, created, locales }], failed }`
- `match --json`: `{ matches: [{ text, keys: [{ source, key, sourceText, ... }] }], convention, namespaces }`. `matches` has one entry per text in order; a match is the same source text after whitespace normalisation. `source: "platform"` keys also have `id`, `draft` and `releaseIds`; `source: "local"` keys exist only in the source-locale file and are not pushed yet. `convention` is `{ prefix, separator, style, maxDepth, guidance }` (`prefix` has no trailing separator, `''` means none; `guidance` is the project's naming advice or null), or null when the server predates it. `namespaces` lists the project's namespace names, relative to the prefix.
- `blocked` in `push --json`: `[{ locale, key, reason, violations? }]`; `reason` is `no-source-text`, `reserved-name` or `key-name`, and `violations` lists what a `key-name` key breaks: `prefix`, `charset`, `segment`, `case` or `depth`.
