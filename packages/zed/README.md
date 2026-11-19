# Localness for Zed

Planned. Not implemented yet.

Zed extensions cannot render custom panels, tree views, webviews or status bar items, so this extension will cover only in-editor features through a language server built on `packages/vscode/src/core` and `@localness/sdk`:

- Hover with translations
- Diagnostics for unknown keys
- Inlay hints with the display-locale text
- Code actions to extract text and edit translations
- Find usages of a key

Key browsing, sync and review remain in the CLI (`packages/cli`). Revisit panels when Zed ships a UI extension API ([zed-industries/zed#53403](https://github.com/zed-industries/zed/discussions/53403)).
