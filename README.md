# localness-tools

Client tooling for [Localness](https://github.com/Hwacc/localness), the screenshot-annotation and translation-key platform.

## Layout

A pnpm workspace; each package lives under `packages/`.

| Package               | Status  | What it is                                                         |
| --------------------- | ------- | ------------------------------------------------------------------ |
| `@localness/sdk`      | Ready   | Typed `/api/v1` client with a pluggable cache and change detection |
| `@localness/unplugin` | Planned | Build-tool plugin (`packages/unplugin`) built on the SDK           |
| VS Code extension     | Preview | Editor integration (`packages/vscode`) built on the SDK            |
| Zed extension         | Planned | Editor integration (`packages/zed`) via a language server          |

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

## Releasing

`@localness/sdk` and `@localness/cli` are published to npm by [`.github/workflows/release.yml`](.github/workflows/release.yml) through npm trusted publishing. Push a tag; the workflow sets the `version` from it, publishes, then commits the new `version` to `main`:

| Tag             | Publishes                                                      |
| --------------- | -------------------------------------------------------------- |
| `sdk@x.y.z`     | `@localness/sdk` at `x.y.z`                                    |
| `cli@x.y.z`     | `@localness/cli` at `x.y.z`                                    |
| `vx.y.z`        | Both at `x.y.z`                                                |
| Manual (no tag) | Every public package whose current `version` is not yet on npm |

A `cli` release depends on the SDK `version` in the tagged commit. When the CLI needs a new SDK, push `vx.y.z`: both get the same version and the SDK is published first. Separate `sdk@` and `cli@` tags also work, but tag `cli` only after the `sdk` release committed its version to `main`.

The VS Code extension is published to the VS Code Marketplace and Open VSX by [`.github/workflows/release-vscode.yml`](.github/workflows/release-vscode.yml) when a `vscode@x.y.z` tag is pushed, with the same version handling; it also renames `## Unreleased` in `packages/vscode/CHANGELOG.md` to `## x.y.z`, so keep pending entries under that heading. Run it manually to retry a failed store. It publishes to both stores through Trusted Publishing (policies for this repository and `release-vscode.yml` on the `localness` publisher and namespace), so no tokens are needed. `pnpm --filter localness-vscode package` builds a `.vsix` locally.
