# @localness/cli

Compares and syncs a repository's locale JSON files with a Localness project. For people and for agents: every command has `--json` output and stable exit codes.

## Install

```sh
pnpm add -D @localness/cli
```

Node 18.3 or later. The token is `LOCALNESS_TOKEN`, read from `.env.local` next to `localness.config.json` first and from the environment otherwise. A read token is enough for `init`, `diff`, `pull`, `push` and `sync`; `apply` and `suggest-name` need a Read & write token. The CLI never uses the VS Code extension's sign-in, and the extension never reads this token: give the CLI (and agents running it) its own token, Read only unless it has to write.

```sh
# .env.local (keep it out of git)
LOCALNESS_TOKEN=lnk_...
```

## Commands

```sh
localness init --base-url https://localness.example.com   # find the locale files, write localness.config.json
localness diff                                            # compare the files with the project
localness pull                                            # write the project's changes into the files
localness push                                            # plan sending local changes; prints a plan id
localness apply 3f9a1c2e                                  # write that plan to the project as drafts
localness sync                                            # pull, then plan a push
localness match "Save" "Cancel"                           # existing keys holding these texts
localness suggest-name "Save changes"                     # ask the project's AI for a key name
localness review start texts.json                         # page to decide keys for extracted texts
localness review wait 1a2b3c4d                            # the decisions, once approved
localness releases use v2.4                               # label the keys push creates with release v2.4
localness skill install                                   # teach coding agents this workflow
```

| Command         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`          | Looks for `dir/{locale}.json` or `dir/{locale}/name.json` layouts, detects flat or nested JSON and writes `localness.config.json`. With `LOCALNESS_TOKEN` set it also fills `project` and maps project locales to file names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `diff`          | Classifies each difference (see below). Read only; never writes the base.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pull`          | Writes `platform-added`, `platform-changed` and `different` into the files and records the base. Local-only keys are kept unless `--prune`. Keys whose path collides with the file's structure are skipped and reported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `push`          | Plans `local-added` and `local-changed` into `.localness/plans/<id>.json` and prints the id. Writes nothing to the project. Keys without source text, with a reserved name, or new keys whose name breaks a strict convention rule (prefix, characters, empty segment) are listed as blocked; new keys off the suggested separator, casing or depth are created and listed as warnings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apply [id]`    | Re-reads the planned keys; if any changed on the project since the plan, or the plan is over an hour old, deletes the plan and writes nothing. Otherwise creates new keys and writes drafts. No id: lists pending plans.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sync`          | Pulls `platform-added` and `platform-changed`, then plans a push like `push`. Never touches `different` or `conflict`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `match`         | For each text, the keys whose source text (draft or published) equals it after whitespace normalisation, plus keys only in the source-locale file (marked `local`, not pushed yet). Several keys per text are all listed. `--json` adds the project's key convention (prefix, separator, style, max depth, naming guidance) and namespace names, for naming new keys. Read only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `suggest-name`  | Prints the project's suggested key name for a source text. Uses AI quota; writes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `review`        | `start <file>` reads `{ "items": [{ "text", "file", "line", "key" }] }`, looks up each text like `match` and opens a page: a tab in VS Code or Cursor when the Localness extension has the project open (it announces itself in `.localness/editors/`), otherwise a browser page (127.0.0.1, random port, secret token in the URL); `--open browser` or `--open editor` forces one. `--json` prints `{ id, url, rows, openedIn }`, `url` null in the editor. Per text the person picks reuse, new key or skip; new names are checked live against the convention and the existing keys (errors block approval, style suggestions only warn), and checked again on approval. `wait <id> [--timeout <s>]` prints the decisions as JSON, or `status: "pending"` after the timeout (default 90 s). Writes nothing to the project or the code; the browser page stops after approval, cancel or two hours. |
| `releases`      | Lists the project's releases (`*` marks the config's). `use <name>` / `use --none` sets the release new keys get; `create <name> [--use]` adds one (project owners). `add\|remove <release> <key...>` relabels existing keys; `--match <glob>` selects keys and asks before changing them (`--yes` skips the question).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `skill install` | Installs the Agent Skill for coding agents; see [Coding agents](#coding-agents).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

`push` and `apply` only write drafts; publishing stays on the platform. A plan holds at most 200 keys.

| Kind               | Meaning                                                        | Handled by           |
| ------------------ | -------------------------------------------------------------- | -------------------- |
| `platform-added`   | The project has text the file lacks                            | pull, sync           |
| `platform-changed` | The project changed since the base; the file did not           | pull, sync           |
| `platform-deleted` | The key left the project; the file still has the base text     | `--prune` / by hand  |
| `local-added`      | The file has text the project lacks                            | push, sync           |
| `local-changed`    | The file changed since the base; the project did not           | push, sync           |
| `local-deleted`    | The file dropped a key the project still has unchanged         | by hand (no deletes) |
| `different`        | Text differs and there is no base yet                          | pull, or `--keys`    |
| `conflict`         | Both changed, or the push would overwrite someone else's draft | `--keys`             |
| `pending-publish`  | The file matches the project's unpublished draft               | publish on platform  |

The base (`.localness/base.json`, next to the config) is the last text the file and the project agreed on; `pull`, `apply` and `sync` update it. Without it, every change is `different`: run `pull` or `sync` once. `.localness/` gets its own `.gitignore`; never commit it.

| Option                 | Commands                              | Description                                                                                  |
| ---------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `--config <path>`      | all                                   | Config file. Default: nearest `localness.config.json`.                                       |
| `--keys <a,b>`         | diff, pull, push, sync                | Only these keys. For `pull` and `push`, take that side even when both changed.               |
| `--locales <en,ja>`    | diff, pull, push, sync                | Only these platform locales.                                                                 |
| `--prune`              | pull                                  | Also remove keys the project does not have.                                                  |
| `--dry-run`            | init, pull, push, sync, skill install | Show what would happen.                                                                      |
| `--json`               | all                                   | Machine-readable output on stdout.                                                           |
| `--base-url <url>`     | init                                  | Localness instance URL. Required.                                                            |
| `--project <name\|id>` | init                                  | Project. Default: the token's only project.                                                  |
| `--dir <path>`         | init                                  | Locale directory, skipping detection.                                                        |
| `--pattern <pattern>`  | init                                  | File pattern under `--dir`, for example `{locale}.json`.                                     |
| `--format <format>`    | init                                  | `flat-json` or `nested-json`.                                                                |
| `--force`              | init, skill install                   | Overwrite an existing config, or a hand-edited Skill.                                        |
| `--agent <a,b>`        | skill install                         | `copilot`, `claude`, `cursor`, `codex` or `all`. Default: the first three.                   |
| `--agents-md`          | skill install                         | Also add a block pointing to the Skill in the root `AGENTS.md`.                              |
| `--root <path>`        | skill install                         | Install here instead of the git root, for a folder opened on its own.                        |
| `--release <name>`     | init                                  | Release new keys are labelled with.                                                          |
| `--none`               | releases use                          | No release for new keys.                                                                     |
| `--use`                | releases create                       | Also make the new release the config's.                                                      |
| `--match <glob>`       | releases add, releases remove         | Keys to relabel, e.g. `checkout.*`.                                                          |
| `--timeout <seconds>`  | review wait                           | How long to wait for the decisions. Default 90.                                              |
| `--open <where>`       | review start                          | `auto` (default: the editor when the extension has the project open), `browser` or `editor`. |
| `--yes`, `-y`          | releases add, releases remove         | Skip the confirmation for `--match`.                                                         |

Exit codes: `0` success (for `diff`: no differences), `1` `diff` found differences, `2` error (including a stale, expired or failed `apply`).

Plans are local files in `.localness/plans/`; the platform knows nothing of them. `push`, `sync` and `apply` without an id delete expired plans; deleting a plan by hand is safe too.

Writes (`apply`) are labeled in the platform's key history as `cli/<version>`, or `cli/<version>; agent` when the CLI runs under an AI agent. Detection is best-effort from the agent's environment (`AI_AGENT`, `CLAUDECODE`, `CURSOR_AGENT`, `COPILOT_CLI`, `CODEX_SANDBOX`, `GEMINI_CLI`). Set `LOCALNESS_AGENT=1` to force the agent label or `LOCALNESS_AGENT=0` to drop it. The label is informational; permissions come from the token.

## Coding agents

`localness skill install` writes an [Agent Skill](https://agentskills.io) at the repository root (the git root above the config) that teaches agents this workflow: `diff --json`, ask a person about conflicts, `pull`, `push --json`, show the plan, and `apply` only after approval. `SKILL.md` holds the rules and points to `references/` for each task (syncing, extracting hardcoded text, releases, JSON output), so an agent reads only what the task needs. Commit the whole folder. If the agents open a subfolder of the repository as their workspace (for example a package inside another repository), pass `--root <that folder>`: agents only look for skills under the folder they opened.

| Agent          | Reads skills from                                    |
| -------------- | ---------------------------------------------------- |
| GitHub Copilot | `.github/skills`, `.claude/skills`, `.agents/skills` |
| Claude Code    | `.claude/skills`                                     |
| Cursor         | `.cursor/skills`, `.claude/skills`, `.agents/skills` |
| Codex          | `.agents/skills`                                     |

It writes as few copies as cover the chosen agents, since an agent reading two copies lists the skill twice: the default (Copilot, Claude Code, Cursor) is the single `.claude/skills/localness/SKILL.md`. Claude Code and Codex share no folder, so `--agent all` writes two. Copies already installed in any of these folders are updated too.

`SKILL.md` records the CLI version and a hash over every file of the Skill. Reinstalling leaves a copy with any hand-edited file alone unless `--force`. `diff`, `pull`, `push`, `apply` and `sync` print a note on stderr when the installed Skill is from another CLI version. Project-specific conventions belong in the platform's Skills page, not in this file.

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

| Field                                                      | Default           | Description                                                                                                                  |
| ---------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                                                  | required          | Localness instance URL.                                                                                                      |
| `project`                                                  | none              | Project id or name. Missing: the token's only project.                                                                       |
| `files.dir`                                                | required in files | Locale directory, relative to the config file.                                                                               |
| `files.pattern`                                            | `{locale}.json`   | File path under `dir`; `{locale}` is the file name of the locale.                                                            |
| `files.format`                                             | `nested-json`     | `nested-json` (`{ "a": { "b": "…" } }`) or `flat-json` (`{ "a.b": "…" }`).                                                   |
| `locales`                                                  | all               | Platform locales to sync.                                                                                                    |
| `localeMap`                                                | none              | Platform locale → file name, when the file is not named after the locale.                                                    |
| `release`                                                  | none              | Release the keys `apply` creates are labelled with. Set it with `localness releases use`. Sync is never filtered by release. |
| `content`                                                  | `published`       | `published` compares what `/bundle` serves; `draft` previews unpublished edits.                                              |
| `keyPatterns`, `useDefaultKeyPatterns`, `extractTemplates` |                   | Used by the VS Code extension.                                                                                               |

Keys of unnamed drafts (`__unnamed_…`) are never written.
