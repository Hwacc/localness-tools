# @localness/cli

Compares and syncs a repository's locale JSON files with a Localness project. For people and for agents: every command has `--json` output and stable exit codes.

## Install

```sh
pnpm add -D @localness/cli
```

Node 18.3 or later. The token is `LOCALNESS_TOKEN`, read from `.env.local` next to `localness.config.json` first and from the environment otherwise; a read token is enough for every command. The CLI never uses the VS Code extension's sign-in, and the extension never reads this token: give the CLI (and agents running it) its own token, Read only unless it has to write.

```sh
# .env.local (keep it out of git)
LOCALNESS_TOKEN=lnk_...
```

## Commands

```sh
localness init --base-url https://localness.example.com   # find the locale files, write localness.config.json
localness diff                                            # compare the files with the project
localness pull --dry-run                                  # show what would be written
localness pull                                            # write the project's text into the files
```

| Command | What it does                                                                                                                                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`  | Looks for `dir/{locale}.json` or `dir/{locale}/name.json` layouts, detects flat or nested JSON and writes `localness.config.json`. With `LOCALNESS_TOKEN` set it also fills `project` and maps project locales to file names. |
| `diff`  | Lists keys missing locally (`+`), with different text (`~`), missing on the platform (`-`) and empty on the platform (`?`).                                                                                                   |
| `pull`  | Writes keys missing locally and different text. Local-only keys are kept unless `--prune`. Keys whose path collides with the file's structure are skipped and reported.                                                       |

| Option                 | Commands   | Description                                              |
| ---------------------- | ---------- | -------------------------------------------------------- |
| `--config <path>`      | all        | Config file. Default: nearest `localness.config.json`.   |
| `--keys <a,b>`         | diff, pull | Only these keys.                                         |
| `--locales <en,ja>`    | diff, pull | Only these platform locales.                             |
| `--prune`              | pull       | Also remove keys the project does not have.              |
| `--dry-run`            | init, pull | Show what would be written.                              |
| `--json`               | all        | Machine-readable output on stdout.                       |
| `--base-url <url>`     | init       | Localness instance URL. Required.                        |
| `--project <name\|id>` | init       | Project. Default: the token's only project.              |
| `--dir <path>`         | init       | Locale directory, skipping detection.                    |
| `--pattern <pattern>`  | init       | File pattern under `--dir`, for example `{locale}.json`. |
| `--format <format>`    | init       | `flat-json` or `nested-json`.                            |
| `--force`              | init       | Overwrite an existing config.                            |

Exit codes: `0` success (for `diff`: no differences), `1` `diff` found differences, `2` error.

## `localness.config.json`

Shared with the VS Code extension. Commit it; tokens never go here.

```json
{
  "baseUrl": "https://localness.example.com",
  "project": "web",
  "files": {
    "dir": "src/locales",
    "pattern": "{locale}.json",
    "format": "nested-json"
  },
  "localeMap": { "zh-CN": "zh_cn" }
}
```

| Field                                                      | Default           | Description                                                                     |
| ---------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `baseUrl`                                                  | required          | Localness instance URL.                                                         |
| `project`                                                  | none              | Project id or name. Missing: the token's only project.                          |
| `files.dir`                                                | required in files | Locale directory, relative to the config file.                                  |
| `files.pattern`                                            | `{locale}.json`   | File path under `dir`; `{locale}` is the file name of the locale.               |
| `files.format`                                             | `nested-json`     | `nested-json` (`{ "a": { "b": "…" } }`) or `flat-json` (`{ "a.b": "…" }`).      |
| `locales`                                                  | all               | Platform locales to sync.                                                       |
| `localeMap`                                                | none              | Platform locale → file name, when the file is not named after the locale.       |
| `content`                                                  | `published`       | `published` compares what `/bundle` serves; `draft` previews unpublished edits. |
| `keyPatterns`, `useDefaultKeyPatterns`, `extractTemplates` |                   | Used by the VS Code extension.                                                  |

Keys of unnamed drafts (`__unnamed_…`) are never written.
