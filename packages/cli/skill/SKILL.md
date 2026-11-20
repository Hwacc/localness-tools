---
name: localness
description: Sync this repository's locale JSON files with its Localness translation project through the `localness` CLI. Use when adding, changing, renaming or removing translatable strings or locale keys, when extracting hardcoded text into locale keys, when touching files under the locale directory named in localness.config.json, or when the locale files and remote disagree.
metadata:
  localness-cli: '{{version}}'
  localness-hash: ''
---

# Localness

The locale JSON files in this repository are synced with a Localness project. The `localness` CLI is the only way to move text between them; if it is not on PATH, run `npx @localness/cli` instead. Each command uses the nearest `localness.config.json` above the working directory, so run it from the package that owns the config. That file names the locale directories (`files` is one directory or a list), their layout and the project. "Remote" means that project's texts on the Localness instance, "local" the locale files; in JSON output `platform` (as in `platform-added` or `onPlatform`) means remote.

## Rules

- Write to remote only with `localness apply <id>`, and only after a person approved that plan in this conversation. Never write through the HTTP API, an MCP server or the web app.
- Never copy text between the locale files and remote by hand: `pull` brings the remote text in, `push` plans sending yours.
- Never decide a `conflict`, `different` or `duplicate` key yourself. Show each side's text and let a person choose.
- Never choose the folder of a key yourself: the CLI routes new keys by the config's `match` rules, and a key it cannot route (`unrouted`) waits for a person to name the directory.
- Never pass `--prune` unless a person asked to delete those keys from the files.
- Edit locale files only for what the task asks for. New or changed product text goes in the source-locale file; other locales are translated in Localness unless the task supplies the translations.
- Never read, print, ask for or write `LOCALNESS_TOKEN`. Never edit or commit `.localness/`.
- `apply` writes drafts. Publishing happens in the Localness web app, so never say the text is live.

## Tasks

Read the reference for the task before running anything:

| Task                                                                     | Read                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| Locale files and remote disagree; adding or changing keys and their text | [references/sync.md](references/sync.md)               |
| Moving hardcoded user-facing text in code into locale keys               | [references/extract.md](references/extract.md)         |
| Release labels on keys, or the release new keys get                      | [references/releases.md](references/releases.md)       |
| Reading a command's `--json` output                                      | [references/json-shapes.md](references/json-shapes.md) |

## Problems

- `Authentication failed`: the token is missing or invalid. Tell the person; they set `LOCALNESS_TOKEN` in `.env.local` next to the config.
- `The token may not do this`: the token is read only. Tell the person; never look for another token.
- No `localness.config.json`: ask the person before running `localness init`.
