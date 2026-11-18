# Releases

Releases are labels on keys in the project; they never filter what is synced. `release` in `localness.config.json` labels the keys `apply` creates, and the plan's `release` says which one. Existing keys keep their labels.

- Never change the config's release, create a release or relabel keys unless a person asked. `localness releases` lists them and marks the current one.
- `localness releases use <name>` (or `--none`) picks the release for new keys; `releases create <name> --use` creates one and needs a project owner's token.
- `localness releases add <release> <key...>` and `releases remove …` relabel existing keys and need a read & write token. With `--match <glob>`, first run it without `--yes` and `--json` to list the matched keys, show them to the person, and pass `--yes` only after they approve.
