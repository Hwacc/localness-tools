# localness-tools

Client tooling for [Localness](https://github.com/Hwacc/localness), the screenshot-annotation and translation-key platform.

## Layout

A pnpm workspace; each package lives under `packages/`.

| Package               | Status  | What it is                                                         |
| --------------------- | ------- | ------------------------------------------------------------------ |
| `@localness/sdk`      | Ready   | Typed `/api/v1` client with a pluggable cache and change detection |
| `@localness/unplugin` | Planned | Build-tool plugin (`packages/unplugin`) built on the SDK           |
| VS Code extension     | Preview | Editor integration (`packages/vscode`) built on the SDK            |

## Development

Requires Node >= 18 and pnpm.

```sh
pnpm install
pnpm build      # build every package
pnpm test       # run unit tests
pnpm typecheck  # strict TypeScript
pnpm lint       # oxlint + prettier --check
```

See [`packages/sdk`](packages/sdk/README.md) for usage.
