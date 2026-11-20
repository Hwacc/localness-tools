# @localness/cli

Compares and syncs a repository's locale JSON files with a Localness project. For people and for agents: every command has `--json` output and stable exit codes.

## Install

```sh
pnpm add -g @localness/cli   # or: npm install -g @localness/cli
localness --help
```

A global install puts `localness` on your PATH, which the examples below, the VS Code extension's default `localness.cliCommand` and the Agent Skill expect. To pin a version per repository instead, add it as a dev dependency (`pnpm add -D @localness/cli`) and run it through `pnpm exec localness` or `npx localness`; to try it without installing, `npx @localness/cli diff`.

Node 18.3 or later. The token is `LOCALNESS_TOKEN`, read from `.env.local` next to `localness.config.json` first and from the environment otherwise. A read token is enough for `init`, `diff`, `pull`, `push` and `sync`; `apply` and `suggest-name` need a Read & write token. The CLI never uses the VS Code extension's sign-in, and the extension never reads this token: give the CLI (and agents running it) its own token, Read only unless it has to write.

```sh
# .env.local (keep it out of git)
LOCALNESS_TOKEN=lnk_...
```

## Terms

- **remote**: the texts of the configured project on the Localness instance.
- **local**: the locale files in the repository.
- **project**: the Localness project named by `project` in `localness.config.json`.
- **Localness**: the product and its instance (web app, API, AI naming).
- **locale**: a language, such as `en` or `ja`.

Identifiers keep the name `platform` for remote: kinds such as `platform-added` and `--json` fields such as `platform` and `onPlatform`.

## Commands

```sh
localness init --base-url https://localness.example.com   # find the locale files, write localness.config.json
localness diff                                            # compare the files with remote
localness pull                                            # write remote changes into the files
localness push                                            # plan sending local changes; prints a plan id
localness apply 3f9a1c2e                                  # write that plan to remote as drafts
localness sync                                            # pull, then plan a push
localness match "Save" "Cancel"                           # existing keys holding these texts
localness suggest-name "Save changes"                     # ask Localness AI for a key name
localness review start texts.json                         # page to decide keys for extracted texts
localness review wait 1a2b3c4d                            # the decisions, once approved
localness releases use v2.4                               # label the keys push creates with release v2.4
localness skill install                                   # teach coding agents this workflow
```

| Command         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `init`          | Looks for `dir/{locale}.json` or `dir/{locale}/name.json` layouts, detects flat or nested JSON and writes `localness.config.json`. With `LOCALNESS_TOKEN` set it also fills `project` and maps project locales to file names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `diff`          | Classifies each difference (see below). Read only; never writes the base.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `pull`          | Writes `platform-added`, `platform-changed` and `different` into the files and records the base. Local-only keys are kept unless `--prune`. Keys whose path collides with the file's structure are skipped and reported. New keys go to the directory their `match` picks; keys no directory fits (`unrouted`) and `duplicate` keys are left, listed, and make `pull` exit 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `push`          | Plans `local-added` and `local-changed` into `.localness/plans/<id>.json` and prints the id. Writes nothing to remote. Keys without source text, with a reserved name, or new keys whose name breaks a strict convention rule (prefix, characters, empty segment) are listed as blocked; new keys off the suggested separator, casing or depth are created and listed as warnings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apply [id]`    | Re-reads the planned keys; if any changed on remote since the plan, or the plan is over an hour old, deletes the plan and writes nothing. Otherwise creates new keys and writes drafts. No id: lists pending plans.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sync`          | Pulls `platform-added` and `platform-changed`, then plans a push like `push`. Never touches `different` or `conflict`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `match`         | For each text, the keys whose source text (draft or published) equals it after whitespace normalisation, plus keys only in the source-locale file (marked `local`, not pushed yet). Several keys per text are all listed. `--json` adds the project's key convention (prefix, separator, style, max depth, naming guidance) and namespace names, for naming new keys. Read only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `suggest-name`  | Prints Localness AI's suggested key name for a source text. Uses AI quota; writes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `review`        | `start <file>` reads `{ "items": [{ "text", "file", "line", "key" }] }`, looks up each text like `match` and opens a page: a tab in VS Code or Cursor when the Localness extension has the project open (it announces itself in `.localness/editors/`), otherwise a browser page (127.0.0.1, random port, secret token in the URL); `--open browser` or `--open editor` forces one. `--json` prints `{ id, url, rows, openedIn }`, `url` null in the editor. Per text the person picks reuse, new key or skip; new names are checked live against the convention and the existing keys (errors block approval, style suggestions only warn), and checked again on approval. `wait <id> [--timeout <s>]` prints the decisions as JSON, or `status: "pending"` after the timeout (default 90 s). Writes nothing to remote or the code; the browser page stops after approval, cancel or two hours. |
| `releases`      | Lists the project's releases (`*` marks the config's). `use <name>` / `use --none` sets the release new keys get; `create <name> [--use]` adds one (project owners). `add\|remove <release> <key...>` relabels existing keys; `--match <glob>` selects keys and asks before changing them (`--yes` skips the question).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `skill install` | Installs the Agent Skill for coding agents; see [Coding agents](#coding-agents).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

`push` and `apply` only write drafts; publishing stays in Localness. A plan holds at most 200 keys.

| Kind               | Meaning                                                        | Handled by           |
| ------------------ | -------------------------------------------------------------- | -------------------- |
| `platform-added`   | Remote has text the file lacks                                 | pull, sync           |
| `platform-changed` | Remote changed since the base; the file did not                | pull, sync           |
| `platform-deleted` | The key left remote; the file still has the base text          | `--prune` / by hand  |
| `local-added`      | The file has text remote lacks                                 | push, sync           |
| `local-changed`    | The file changed since the base; remote did not                | push, sync           |
| `local-deleted`    | The file dropped a key remote still has unchanged              | by hand (no deletes) |
| `different`        | Text differs and there is no base yet                          | pull, or `--keys`    |
| `conflict`         | Both changed, or the push would overwrite someone else's draft | `--keys`             |
| `pending-publish`  | The file matches the unpublished remote draft                  | publish in Localness |

The base (`.localness/base.json`, next to the config) is the last text the file and remote agreed on; `pull`, `apply` and `sync` update it. Without it, every change is `different`: run `pull` or `sync` once. `.localness/` gets its own `.gitignore`; never commit it.

| Option                 | Commands                              | Description                                                                                                                 |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--config <path>`      | all                                   | Config file. Default: nearest `localness.config.json`.                                                                      |
| `--keys <a,b>`         | diff, pull, push, sync                | Only these keys. For `pull` and `push`, take that side even when both changed.                                              |
| `--locales <en,ja>`    | diff, pull, push, sync                | Only these project locales.                                                                                                 |
| `--prune`              | pull                                  | Also remove keys remote does not have.                                                                                      |
| `--dry-run`            | init, pull, push, sync, skill install | Show what would happen.                                                                                                     |
| `--json`               | all                                   | Machine-readable output on stdout. For `diff`, `pull`, `push`, `sync` and `apply <id>` it names the `config` file used.     |
| `--base-url <url>`     | init                                  | Localness instance URL. Required.                                                                                           |
| `--project <name\|id>` | init                                  | Project. Default: the token's only project.                                                                                 |
| `--dir <path>`         | init                                  | Locale directory, skipping detection.                                                                                       |
| `--pattern <pattern>`  | init                                  | File pattern under `--dir`, for example `{locale}.json`.                                                                    |
| `--into <dir>`         | pull, sync                            | Configured directory for keys that have no place yet (`unrouted`, or a locale added to a `duplicate`). A person chooses it. |
| `--format <format>`    | init                                  | `flat-json` or `nested-json`.                                                                                               |
| `--force`              | init, skill install                   | Overwrite an existing config, or a hand-edited Skill.                                                                       |
| `--agent <a,b>`        | skill install                         | `copilot`, `claude`, `cursor`, `codex` or `all`. Default: the first three.                                                  |
| `--agents-md`          | skill install                         | Also add a block pointing to the Skill in the root `AGENTS.md`.                                                             |
| `--root <path>`        | skill install                         | Install here instead of the git root, for a folder opened on its own.                                                       |
| `--global`             | skill install                         | Install in your home folder, for every repository. Not with `--root` or `--agents-md`.                                      |
| `--release <name>`     | init                                  | Release new keys are labelled with.                                                                                         |
| `--none`               | releases use                          | No release for new keys.                                                                                                    |
| `--use`                | releases create                       | Also make the new release the config's.                                                                                     |
| `--match <glob>`       | releases add, releases remove         | Keys to relabel, e.g. `checkout.*`.                                                                                         |
| `--timeout <seconds>`  | review wait                           | How long to wait for the decisions. Default 90.                                                                             |
| `--open <where>`       | review start                          | `auto` (default: the editor when the extension has the project open), `browser` or `editor`.                                |
| `--yes`, `-y`          | releases add, releases remove         | Skip the confirmation for `--match`.                                                                                        |

Exit codes: `0` success (for `diff`: no differences), `1` `diff` found differences, `2` error (including a stale, expired or failed `apply`).

Plans are local files in `.localness/plans/`; remote knows nothing of them. `push`, `sync` and `apply` without an id delete expired plans; deleting a plan by hand is safe too.

Writes (`apply`) are labeled in the key history on remote as `cli/<version>`, or `cli/<version>; agent` when the CLI runs under an AI agent. Detection is best-effort from the agent's environment (`AI_AGENT`, `CLAUDECODE`, `CURSOR_AGENT`, `COPILOT_CLI`, `CODEX_SANDBOX`, `GEMINI_CLI`). Set `LOCALNESS_AGENT=1` to force the agent label or `LOCALNESS_AGENT=0` to drop it. The label is informational; permissions come from the token.

## Coding agents

`localness skill install` writes an [Agent Skill](https://agentskills.io) at the repository root (the git root above the config) that teaches agents this workflow: `diff --json`, ask a person about conflicts, `pull`, `push --json`, show the plan, and `apply` only after approval. `SKILL.md` holds the rules and points to `references/` for each task (syncing, extracting hardcoded text, releases, JSON output), so an agent reads only what the task needs. Commit the whole folder. If the agents open a subfolder of the repository as their workspace (for example a package inside another repository), pass `--root <that folder>`: agents only look for skills under the folder they opened.

| Agent          | Reads skills from                                    |
| -------------- | ---------------------------------------------------- |
| GitHub Copilot | `.github/skills`, `.claude/skills`, `.agents/skills` |
| Claude Code    | `.claude/skills`                                     |
| Cursor         | `.cursor/skills`, `.claude/skills`, `.agents/skills` |
| Codex          | `.agents/skills`                                     |

It writes as few copies as cover the chosen agents, since an agent reading two copies lists the skill twice: the default (Copilot, Claude Code, Cursor) is the single `.claude/skills/localness/SKILL.md`. Claude Code and Codex share no folder, so `--agent all` writes two. Copies already installed in any of these folders are updated too.

`SKILL.md` records the CLI version and a hash over every file of the Skill. Reinstalling leaves a copy with any hand-edited file alone unless `--force`. `diff`, `pull`, `push`, `apply` and `sync` print a note on stderr when the installed Skill is from another CLI version. Project-specific conventions belong in the Skills page in Localness, not in this file.

To give your agents the Skill in every repository without committing it, install it once in your home folder:

```sh
localness skill install --global                 # Copilot, Claude Code, Cursor
localness skill install --global --agent codex
```

| Agent          | Reads skills from (home folder)                                               |
| -------------- | ----------------------------------------------------------------------------- |
| GitHub Copilot | `~/.copilot/skills`, `~/.agents/skills`                                       |
| Claude Code    | `~/.claude/skills`                                                            |
| Cursor         | `~/.cursor/skills`, `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills` |
| Codex          | `~/.agents/skills`                                                            |

The same rule picks the fewest copies: the default writes `~/.claude/skills/localness` (Claude Code, Cursor) and `~/.copilot/skills/localness` (Copilot). `--global` leaves `AGENTS.md` alone and cannot be combined with `--root` or `--agents-md`; `--agent`, `--dry-run`, `--force` and `--json` work as usual. An agent that reads both a repository copy and a home-folder copy lists the skill twice, so pick one per machine or repository. Rerun `localness skill install --global` after upgrading the CLI; the stderr note names `--global` when the home-folder copy is the outdated one.

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

| Field                                                      | Default         | Description                                                                                                                                                |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                                                  | required        | Localness instance URL.                                                                                                                                    |
| `project`                                                  | none            | Project id or name. Missing: the token's only project.                                                                                                     |
| `files`                                                    | none            | One directory object, or a list of them (below).                                                                                                           |
| `files[].dir`                                              | required        | Locale directory, relative to the config file; unique in the list.                                                                                         |
| `files[].pattern`                                          | `{locale}.json` | File path under `dir`; `{locale}` is the file name of the locale.                                                                                          |
| `files[].format`                                           | `nested-json`   | `nested-json` (`{ "a": { "b": "…" } }`) or `flat-json` (`{ "a.b": "…" }`), per directory.                                                                  |
| `files[].match`                                            | none            | Which new keys go to this directory: `key` (regular expression on the whole key) and/or `namespace` (a project namespace); all given conditions must hold. |
| `locales`                                                  | all             | Project locales to sync.                                                                                                                                   |
| `localeMap`                                                | none            | Project locale → file name, when the file is not named after the locale.                                                                                   |
| `release`                                                  | none            | Release the keys `apply` creates are labelled with. Set it with `localness releases use`. Sync is never filtered by release.                               |
| `content`                                                  | `published`     | `published` compares what `/bundle` serves; `draft` previews unpublished edits.                                                                            |
| `keyPatterns`, `useDefaultKeyPatterns`, `extractTemplates` |                 | Used by the VS Code extension.                                                                                                                             |

Keys of unnamed drafts (`__unnamed_…`) are never written.

### Several directories

`files` takes one object or a list. A single object works exactly as before.

```json
"files": [
  { "dir": "src/locales/default" },
  { "dir": "src/locales/boostprime", "match": { "namespace": "boostprime" } }
]
```

- Where a key lives: the directory that already has it (in any locale), else the first entry whose `match` fits, else the first entry without a `match` (the fallback). With none of these the key is `unrouted`: `pull` and `sync` skip it, list it, and exit 1; a person picks the directory with `localness pull --keys <key> --into <dir>`, and the key stays there afterwards.
- A key present in more than one directory is a `duplicate` (judged per key, across locales). Equal texts everywhere: `pull` updates every copy and `push` works as usual. Different texts, or remote added a locale the key has no file for: `pull`, `push` and `sync` skip it and list it; `pull --keys <key>` writes the remote text to every copy (`--into <dir>` places a locale with no copy yet).
- `match.namespace` is checked against the project's namespaces; an unknown name is reported as a warning. `init` finds sibling directories such as `default/` and `boostprime/`, picks a fallback (`default`, `common`, … or the largest) and infers `match` from the keys: the project namespace most of a directory's keys belong to, else the leading word they share.
- Git-sync's `locale-files` setting in Localness is still a single directory; this list exists only in `localness.config.json`.
