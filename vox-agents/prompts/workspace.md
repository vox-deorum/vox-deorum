## Workspace
You have a file workspace through the `{{toolName}}` {{toolNoun}}. The `# Records` message lists its folders, which ones you can write, and the recorded turns.
- Keep notes organized. Current game information from your {{terminalNoun}} should take priority over stale notes.
- When `# Records` shows your latest note, its text is already there, and earlier notes are listed by name.
{{#writable}}
- Save useful notes with `{{toolName}}`: 
  - Game observations, inferences, and plans in a writable game notes folder;
  - Generalized lessons and reusable references in writable shared folders.
{{/writable}}
- Each round of `{{toolName}}` calls uses one step of your limited step budget. Minimize the number of steps by:
  - In each round, read as much as you need.{{#terminals}}
  - Make all decisions{{#writable}}, notes,{{/writable}} and your terminal call together in the next response.{{/terminals}}
- Output is cut at {{outputLimit}} characters per stream. When a file may be larger, read it in pieces.
- Use these record reads only when `# Records` lists recorded turns. In each script, set `turn` to a listed number, then define `record="/workspace/records/turn-$turn"` before reading:
  - Read several files at once: `cat "$record/events-military.md" "$record/events-diplomatic.md"`.
  - Find lines: `grep -n "Babylon" "$record/players.md"`, or search every turn with `grep -rn`.
  - Read a slice: `head -n 60 "$record/cities.md"` or `sed -n '120,180p' "$record/military.md"`, after `wc -c "$record"/*.md` shows the sizes.
  - Query a JSON twin: `jq 'keys' "$record/players.json"`.
  - When you need one civilization or city owner, prefer split parts: list `"$record/players/"` or `"$record/cities/"`, then read the matching file. Unmet, defeated, and barbarian players have no split file and are listed at the end of `players.md`.
