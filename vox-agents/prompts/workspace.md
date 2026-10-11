## Workspace
You have a file workspace through the `{{toolName}}` {{toolNoun}}.
- `/workspace/records` (read): reports, events, and briefings recorded for each turn. Its CATALOG.md lists every section's files, gaps between turn folders, briefings, and file sizes.
- `/workspace/reference` (read): game reference on technologies, policies, buildings, and units.
{{#game}}
- `/workspace/game` ({{access}}): shared with the other agents of your civilization in this game. Follow its AGENTS.md.
{{/game}}
{{#shared}}
- `/workspace/shared/{{name}}` ({{access}}): outlives this game and is seen by other games and seats. Keep only general lessons and references here.
{{/shared}}
- Keep notes organized. Current game information from your {{terminalNoun}} should take priority over stale notes.
- Each round of `{{toolName}}` calls uses one step of your limited step budget.
  - Make independent `{{toolName}}` calls in parallel, or combine them in one script.
  - Write files with heredocs.
- Output is cut at {{outputLimit}} characters per stream, so read large files in pieces. {{#hasTurn}}The latest recorded turn is {{turn}}, so these examples use its folder:{{/hasTurn}}{{^hasTurn}}No turn is recorded yet. In these examples, {{turn}} stands for a recorded turn number:{{/hasTurn}}
  - Check sizes first: `wc -c /workspace/records/turn-{{turn}}/*.md`.
  - Find lines: `grep -n "Babylon" /workspace/records/turn-{{turn}}/players.md`, or search every turn with `grep -rn`.
  - Read a slice: `head -n 60 /workspace/records/turn-{{turn}}/cities.md` or `sed -n '120,180p' /workspace/records/turn-{{turn}}/military.md`.
  - Query a JSON twin: `jq 'keys' /workspace/records/turn-{{turn}}/players.json`.
  - Prefer split parts, such as `/workspace/records/turn-{{turn}}/players/<civilization>.md`, when you need one civilization or zone.
