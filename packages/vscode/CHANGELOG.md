# Changelog

## Unreleased

- Locale files in several directories (`files` as a list): new keys go where the config's `match` rules say, extraction offers the suggested directory, keys in several directories show up as `duplicate` in the Local Files view and in Problems, and unplaceable keys ask for a directory.
- The texts on Localness are now called "remote" throughout ("New on remote", "Compare with remote", "Push to remote", hover "Remote:"); "project" now only means the Localness project. Command ids and context values are unchanged.
- Several `localness.config.json` in one workspace: the extension keeps the active config when focus moves to a settings page, output panel, untitled file or a file with no config above it, instead of jumping to the first workspace folder. Editing another package's config no longer reloads the current one. Diagnostics ("Key not found on remote") only cover files under the active config's folder; hover works everywhere.
- The status bar tooltip shows the active config file (click to open it). With more than one config, the Keys and Local Files views show its folder, and the new **Localness: Switch config** command (also in the status bar tooltip and menu) picks one; opening a file under another config still switches automatically.

## 0.1.0

- Initial release: hover, inline hints, diagnostics, key tree, search, status bar, translation editing, text extraction and locale file sync.
