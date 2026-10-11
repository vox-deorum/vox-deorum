## Workspace
You have a file workspace through the `{{toolName}}` {{toolNoun}}. The `# Records` message lists its folders, which ones you can write, and the recorded turns.
- Keep notes organized. Current game information from your {{terminalNoun}} should take priority over stale notes.
{{#writable}}
- Save useful notes with `{{toolName}}`: game observations, inferences, and plans only in a writable game notes folder; generalized lessons and reusable references only in writable shared folders.{{#terminals}} Save before or alongside your terminal {{terminalNoun}}.{{/terminals}}
{{/writable}}
- Each round of `{{toolName}}` calls uses one step of your limited step budget. Make independent `{{toolName}}` calls in parallel, or combine them in one script.
- Output is cut at {{outputLimit}} characters per stream, so read large files in pieces.
- Use these record reads only when `# Records` lists recorded turns. In each script, set `turn` to a listed number, then define `record="/workspace/records/turn-$turn"` before reading:
  - Check sizes first: `wc -c "$record"/*.md`.
  - Find lines: `grep -n "Babylon" "$record/players.md"`, or search every turn with `grep -rn`.
  - Read a slice: `head -n 60 "$record/cities.md"` or `sed -n '120,180p' "$record/military.md"`.
  - Query a JSON twin: `jq 'keys' "$record/players.json"`.
  - When you need one civilization or zone, prefer split parts: list `"$record/players/"`, then read the matching file.
