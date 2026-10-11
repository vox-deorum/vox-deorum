## Workspace
You have a file workspace through the `{{toolName}}` {{toolNoun}}. The `# Records` message lists its folders, which ones you can write, and the recorded turns.
- Keep notes organized. Current game information from your {{terminalNoun}} should take priority over stale notes.
{{#writable}}
- Save what later turns or your civilization's other agents should know in a writable folder.{{#terminals}} Write before your terminal {{toolNoun}} or in the same reply, since nothing runs after it.{{/terminals}}
{{/writable}}
- Each round of `{{toolName}}` calls uses one step of your limited step budget. Make independent `{{toolName}}` calls in parallel, or combine them in one script.
- Output is cut at {{outputLimit}} characters per stream, so read large files in pieces. In these examples, `<N>` is a recorded turn number from `# Records`:
  - Check sizes first: `wc -c /workspace/records/turn-<N>/*.md`.
  - Find lines: `grep -n "Babylon" /workspace/records/turn-<N>/players.md`, or search every turn with `grep -rn`.
  - Read a slice: `head -n 60 /workspace/records/turn-<N>/cities.md` or `sed -n '120,180p' /workspace/records/turn-<N>/military.md`.
  - Query a JSON twin: `jq 'keys' /workspace/records/turn-<N>/players.json`.
  - Prefer split parts, such as `/workspace/records/turn-<N>/players/<civilization>.md`, when you need one civilization or zone.
