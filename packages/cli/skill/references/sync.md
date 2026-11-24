# Syncing locale files

1. Run `localness diff --json`. Exit code 0: nothing differs. 1: differences. 2: error.
2. Sort each difference by `kind` (table below). Kinds marked Ask need a person, and so does an `unrouted` key (its `target.by` is `unrouted`). `empty` is only reported.
3. When any key needs a person, run `localness review start --kind resolve --json` (add `--config <path>` when you are using one; the commands it returns then carry the same flag). It opens a page where the person decides each key, and can choose per locale. With `openedIn: "editor"` the page opened as a tab in their editor; with `openedIn: "browser"` give them the `url`. Then run `localness review wait <id>` until `status` is no longer `pending`.
   - `id: null` means nothing needs a decision. Continue below.
   - `approved`: run `commands` in order. A `pull` command (including `--prune`) writes the locale files now. A `push` command only plans: take it to step 6, and `apply` only after the person approves that plan. Do not pull or push those keys again another way. `cancelled` means change nothing and stop.
   - Fall back to a table in the chat when `review start` fails (no browser, remote machine) or the person asks for it. One row per key and locale: kind, local text, remote text, and the choices (remote, local, delete locally, or skip; a directory when the key has no place). Apply their reply, show the updated table, and wait again.
   - Either way, change no files before they approve.
4. Bring in the remote text the page did not cover. `localness sync` pulls `platform-added` and `platform-changed` and plans the local kinds, and it leaves `different` alone. Use that, or `localness pull --keys` with only the `platform-added` and `platform-changed` keys. Do not run a plain `localness pull` after the page: it also takes every `different` key, including ones the person chose to push or skip. `sync` still reports the `unrouted` and `duplicate` keys the person skipped, and exits 1 for them; they are decided, so do not ask again. When the review was not needed, `localness pull` is still the plain pull.
5. Plan local changes the page did not cover: `localness push --json`, or `localness push --keys <a,b> --json` for keys the person gave to the local side. It writes nothing to remote. Skip this when step 4 was `localness sync`, which already planned them.
6. Show the plan to the person: its id, and for each key whether it is created or updated and every locale's old → new text. Also show `blocked`, `warnings` and `leftOut`.
7. Only after the person approves, run `localness apply <id>`. If it reports the plan stale or expired, nothing was written: run `diff` again and start over; never retry the same id.
8. Report what was written, and that drafts wait for a publish in the web app.

With several `localness.config.json` files, do these steps once per config the task touches, from that config's folder or with `--config <path>`. Plans live in that config's `.localness/plans/`, so run `apply <id>` with the same config; the `config` field of `push --json` and `apply --json` must match.

`localness sync` does steps 4 and 5 together for the unambiguous kinds. `--dry-run` previews `pull`, `push` and `sync`.

| `kind`             | Meaning                                                                                | Action                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `platform-added`   | Remote has text the file lacks                                                         | `pull`                                                                                         |
| `platform-changed` | Remote changed it; the file did not                                                    | `pull`                                                                                         |
| `local-added`      | The file has text remote lacks                                                         | `push`                                                                                         |
| `local-changed`    | The file changed it; remote did not                                                    | `push`                                                                                         |
| `pending-publish`  | The file matches an unpublished draft                                                  | Nothing; it gets published in the web app                                                      |
| `empty`            | The file writes the key with an empty value and the project has no text                | Tell the person; deleting the key falls back to the source locale, or wait for the translation |
| `conflict`         | Both sides changed, or a push would overwrite someone's draft                          | Ask; then `pull --keys` or `push --keys`                                                       |
| `different`        | The texts differ and there is no base yet                                              | Ask; then `pull --keys` or `push --keys`                                                       |
| `platform-deleted` | The key left remote; the file still has it                                             | Ask; remove it from the file, or `pull --prune` when the person wants all of them gone         |
| `local-deleted`    | The file dropped a key remote still has                                                | Ask; the CLI never deletes keys on remote, a person does that in the web app                   |
| `duplicate`        | The key is in several directories with different texts, or remote added a locale to it | Ask; show every location and the remote text (see "Several directories")                       |

An empty value usually renders blank instead of falling back to the source locale. Do not pull or push it, and delete it only when the person asks. A stderr warning that a file is not a project locale means its name matches the pattern but no project locale (`zh.json` when the project has `zh_cn` usually needs `localeMap`). That file is not read, pulled or pushed. If the warning says it cannot be parsed, the file is empty or not JSON. Report these warnings; never edit `localeMap`, rename or delete the file yourself.

When `hasBase` is false (the first sync), every changed text is `different`. The resolve page lists them. Say so before a plain `pull`: it takes the remote text for all of them.

## New keys

- Name a new key after the project's key convention (`localness match --json` prints it as `convention`) and the neighbouring keys in the same file. `push` blocks a new key whose name breaks a strict rule (prefix, characters, empty segment), with reason `key-name`: rename it in the locale file and the code, then plan again. New keys off the suggested separator, casing or depth are created and listed in `warnings`; mention them, but they need no rename. `localness suggest-name "<source text>"` asks Localness AI for one name, but it is slow, uses the project's AI quota and needs a read & write token: only use it for a few strings a person asked about. Names starting with `__unnamed_` are reserved.
- A new key needs its text in the source-locale file. `apply` creates the key and publishes that source text; text in other locales becomes drafts.
- A plan holds at most 200 keys and expires after an hour.

## Arrays

Arrays in a locale file are read by index: `land.how_list.0.title`, `help.tips.0`. The CLI only updates elements an array already has. A new key past the end of an array is listed in `skipped`, and a key `--prune` would remove from an array stays and is listed in `keptInArray`: removing an element would shift the keys of the elements after it. Tell the person about both; adding or removing array elements is a hand edit they decide on. `push` sends array keys like any other key.

## Several directories

`files` may list several directories (for example `src/locales/default` and `src/locales/boostprime`). A key lives in the directory that already has it; a new key goes to the first directory whose `match` fits (`key` regex, project `namespace`), else to the one without a `match`. `diff --json` shows each difference's `target` (`{ dir, by }`), `locations` and `dirs`.

- `pull` and `sync` exit 1 when keys wait for a person. Their JSON lists them in `unrouted` and `duplicates`, and `dirs` holds the configured directories.
- `unrouted`: a new key that no `match` fits, with no fallback directory. Never choose the folder yourself: list the keys and the `dirs` and ask. Then `localness pull --keys <a,b> --into <dir>`; the key stays in that directory afterwards.
- `duplicate`: a key in more than one directory. If its texts are equal everywhere, `pull` updates every copy and `push` works as usual. If they differ, or remote added a locale the key has no file for, `pull`, `push` and `sync` skip it. Show each location's text and the remote text, and let a person pick: `pull --keys <key>` writes the remote text to every copy (add `--into <dir>` for a locale with no copy yet), or the person deletes the extra copies by hand.
- The git-sync `locale-files` setting in Localness is still a single directory; the multi-directory layout exists only in `localness.config.json`.
