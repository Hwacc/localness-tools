# Extracting hardcoded text

When a person asks to move hardcoded user-facing text into locale keys:

1. Only look in the files or folders the person named. Skip text that is not shown to users: log messages, ids, CSS classes, URLs, test data, and text already passed to the i18n function.
2. Run `localness match --json "<text>" "<text>" ...` with every string at once. Keys come from the project (`source: "platform"`) and from the source-locale file when not pushed yet (`source: "local"`). A text with exactly one key reuses it. A text with several keys lists them all for the person to pick; never pick one yourself. Mark local keys in the table, and flag one whose name breaks `convention`: push will block it.
3. Name a key for each text without one, using `convention` and `namespaces` from the same output:
   - With a `prefix`, start the name with it and `separator`.
   - Write each segment in `style` (`snake_case` or `camelCase`), and use at most `maxDepth` segments after the prefix.
   - Put the key under the namespace of the page or feature it belongs to when one fits; namespace names follow the prefix.
   - Follow `guidance` when it is set, and stay close to the neighbouring keys in the locale file.
   - Never reuse a name another key already has.
4. Show one table and wait for approval. Columns: `#` (1, 2, 3, ...), text, file and line, then either the key to reuse (with its alternatives) or the new name. Below the table, tell the person they can approve everything, or reply with row numbers and what to do, for example `2 use auth_sign_in_title`, `5 rename to cart_coupon_label`, `7 skip`. Apply their instructions, show the updated table with the same numbers, and wait again. Change no files before they approve.
5. After approval, add the new keys with their text to the source-locale file only, and replace each string in the code with the i18n call the file already uses (same function, import and argument style). Reused keys need no locale file change.
6. Continue with [sync.md](sync.md) from `localness push --json`: show the plan, and `apply` only after approval. A key blocked with `key-name` breaks the convention: rename it and plan again.

Never rename or delete existing keys while extracting, and never touch code outside the scope the person named.
