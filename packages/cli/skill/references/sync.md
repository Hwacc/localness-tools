# Syncing locale files

1. Run `localness diff --json`. Exit code 0: nothing differs. 1: differences. 2: error.
2. Sort each difference by `kind` (table below) and list everything that needs a person.
3. Ask the person about those keys and wait for the answer.
4. Bring the project's text in: `localness pull`, or `localness pull --keys <a,b>` for keys the person gave to the project.
5. Plan local changes: `localness push --json`, or `localness push --keys <a,b> --json` for keys the person gave to the local side. It writes nothing to the project.
6. Show the plan to the person: its id, and for each key whether it is created or updated and every locale's old → new text. Also show `blocked` and `leftOut`.
7. Only after the person approves, run `localness apply <id>`. If it reports the plan stale or expired, nothing was written: run `diff` again and start over; never retry the same id.
8. Report what was written, and that drafts wait for a publish in the web app.

`localness sync` does steps 4 and 5 together for the unambiguous kinds. `--dry-run` previews `pull`, `push` and `sync`.

| `kind`             | Meaning                                                       | Action                                                                                 |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `platform-added`   | The project has text the file lacks                           | `pull`                                                                                 |
| `platform-changed` | The project changed it; the file did not                      | `pull`                                                                                 |
| `local-added`      | The file has text the project lacks                           | `push`                                                                                 |
| `local-changed`    | The file changed it; the project did not                      | `push`                                                                                 |
| `pending-publish`  | The file matches an unpublished draft                         | Nothing; it gets published in the web app                                              |
| `conflict`         | Both sides changed, or a push would overwrite someone's draft | Ask; then `pull --keys` or `push --keys`                                               |
| `different`        | The texts differ and there is no base yet                     | Ask; then `pull --keys` or `push --keys`                                               |
| `platform-deleted` | The key left the project; the file still has it               | Ask; remove it from the file, or `pull --prune` when the person wants all of them gone |
| `local-deleted`    | The file dropped a key the project still has                  | Ask; the CLI never deletes project keys, a person does that in the web app             |

When `hasBase` is false (the first sync), every changed text is `different`. Say so before pulling: a plain `pull` takes the project's text for all of them.

## New keys

- Name a new key after the project's key convention (`localness match --json` prints it as `convention`) and the neighbouring keys in the same file. `push` blocks a new key whose name breaks the convention, with reason `key-name`: rename it in the locale file and the code, then plan again. `localness suggest-name "<source text>"` asks the project's AI for one name, but it is slow, uses the project's AI quota and needs a read & write token: only use it for a few strings a person asked about. Names starting with `__unnamed_` are reserved.
- A new key needs its text in the source-locale file. `apply` creates the key and publishes that source text; text in other locales becomes drafts.
- A plan holds at most 200 keys and expires after an hour.
