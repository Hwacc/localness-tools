# Extracting hardcoded text

When a person asks to move hardcoded user-facing text into locale keys:

1. Only look in the files or folders the person named. Skip text that is not shown to users: log messages, ids, CSS classes, URLs, test data, and text already passed to the i18n function.
2. Run `localness match --json "<text>" "<text>" ...` with every string at once. Keys come from remote (`source: "platform"`) and from the source-locale file when not pushed yet (`source: "local"`). A text with exactly one key reuses it. A text with several keys lists them all for the person to pick; never pick one yourself. Mark local keys in the table, and flag one whose name breaks a strict rule of `convention` (prefix, characters other than letters, digits, `.`, `_`, `-`, or an empty segment): push will block it.
3. Name a key for each text without one, using `convention` and `namespaces` from the same output:
   - With a `prefix`, start the name with it and `separator`. This is required.
   - Prefer `separator`, write each segment in `style` (`snake_case` or `camelCase`; `none` means match the neighbouring keys), and use at most `maxDepth` segments after the prefix. These are suggestions: push still creates a key that misses them and lists it in `warnings`.
   - Put the key under the namespace of the page or feature it belongs to when one fits; namespace names follow the prefix.
   - Follow `guidance` when it is set, and stay close to the neighbouring keys in the locale file.
   - Never reuse a name another key already has.
4. Let the person review on a page. Write `{ "items": [{ "text", "file", "line", "key" }] }` to `.localness/review-input.json` next to the config you use (the one nearest the files you change), one item per text in the order of your list: `file` relative to the current folder, `key` the name you proposed (leave it out for texts with an existing key). Run `localness review start .localness/review-input.json --json`; it opens a page where the person picks reuse, new key or skip per text, edits names checked live against the convention, and approves. With `openedIn: "editor"` the page opened as a tab in their editor (the Localness extension has the project open); with `openedIn: "browser"` give them the `url` it prints. Then run `localness review wait <id>` until `status` is no longer `pending`. `approved` returns `items: [{ index, text, file, line, action, key, source }]`: `reuse` means use `key` (`source: "local"` is a key not pushed yet), `create` means add `key` with `text`, `skip` means leave the text. `cancelled` means change nothing and stop.
   Fall back to a table in the chat when `review start` fails (no browser, remote machine) or the person asks for it. Columns: `#` (1, 2, 3, ...), text, file and line, then either the key to reuse (with its alternatives) or the new name. Below the table, tell the person they can approve everything, or reply with row numbers and what to do, for example `2 use auth_sign_in_title`, `5 rename to cart_coupon_label`, `7 skip`. Apply their instructions, show the updated table with the same numbers, and wait again.
   Either way, change no files before they approve.
5. After approval, add the new keys with their text to the source-locale file only, and replace each string in the code with the i18n call the file already uses (same function, import and argument style). Reused keys need no locale file change; skipped texts stay as they are.
6. Continue with [sync.md](sync.md) from `localness push --json`: approve the plan on the plan page, or in the chat when that page will not open. A key blocked with `key-name` breaks the convention: rename it and plan again.

Never rename or delete existing keys while extracting, and never touch code outside the scope the person named.
