# JSON shapes

- `diff --json`: `{ sourceLocale, locales, content, hasBase, files, differences: [{ locale, key, kind, local, platform, draft, base, onPlatform }] }`
- `push --json`: `{ id, path, expiresAt, sourceLocale, release, keys: [{ key, create, locales: { <locale>: { text, platform, draft } } }], blocked, warnings, leftOut }`; `id` is null when there is nothing to push; `release` is the name new keys get, or null.
- `apply <id> --json`: `{ id, written: [{ key, created, locales }], failed }`
- `match --json`: `{ matches: [{ text, keys: [{ source, key, sourceText, ... }] }], convention, namespaces }`. `matches` has one entry per text in order; a match is the same source text after whitespace normalisation. `source: "platform"` keys also have `id`, `draft` and `releaseIds`; `source: "local"` keys exist only in the source-locale file and are not pushed yet. `convention` is `{ prefix, separator, style, maxDepth, guidance }` (`style` is `snake_case`, `camelCase` or `none`) (`prefix` has no trailing separator, `''` means none; `guidance` is the project's naming advice or null), or null when the server predates it. `namespaces` lists the project's namespace names, relative to the prefix.
- `review start --json`: `{ id, url, rows }`. Input file: `{ items: [{ text, file?, line?, key? }] }`.
- `review wait <id>`: `{ id, status, items }`; `status` is `pending` (also has `url`; run it again), `approved` or `cancelled` (`items` empty). Items: `{ index, text, file, line, action, key, source }`, `action` is `reuse`, `create` or `skip`; `skip` has no `key`, only `reuse` has `source` (`platform` or `local`).
- `blocked` in `push --json`: `[{ locale, key, reason, violations? }]`; `reason` is `no-source-text`, `reserved-name` or `key-name`, and `violations` lists what a `key-name` key breaks: `prefix`, `charset` or `segment`.
- `warnings` in `push --json`: `[{ key, violations }]`, new keys that are still created but miss a suggestion: `separator`, `case` or `depth`.
