# Records
Your workspace holds the game's records and your civilization's notes accessible through `Bash`.

## Folders
| Folder | Access | Holds |
| --- | --- | --- |
| `/workspace/records` | read-only | Complete reports, events, and any briefings for each processed turn, written by the host. |
| `/workspace/reference` | read-only | Game technologies, policies, buildings, and units with their tooltips, in files by era (buildings also by corporation and belief), or by branch for policies. |
{{#game}}
| `/workspace/game` | {{#writable}}writable{{/writable}}{{^writable}}read-only{{/writable}} | Notes shared by every agent of your civilization in this game. They persist across turns. |
{{/game}}
{{#shared}}
| `/workspace/shared/{{name}}` | {{#writable}}writable{{/writable}}{{^writable}}read-only{{/writable}} | General lessons and references that outlive this game, seen by other games and seats. |
{{/shared}}
| `/tmp` | writable | Scratch space for your civilization's agents, kept for this game. |

Files written anywhere else disappear after each command.

## Reference
`/workspace/reference` has one folder per category. Every `.md` file has a `.json` twin.
- `technologies/`, `buildings/`, `units/`: one file per era, such as `units/ancient.md` or `buildings/industrial.md`.
  - `buildings/` has `corporations.md` for corporation buildings, `religious.md` for religious buildings, and `other.md` for special buildings.
  - `units/other.md` holds great people and faith units.
- `policies/`: one file per branch, such as `policies/tradition.md` or `policies/fealty.md`.

Each entry is a `## <Name>` heading and one list. Entries that share a name get a suffix, such as `## Longswordsman (England)`. For example:

- Read one entry: `awk '/^## /{p=($0=="## Agriculture")} p' /workspace/reference/technologies/ancient.md`
- Or from the twin: `jq '.[] | select(.Name == "Agriculture")' /workspace/reference/technologies/ancient.json`
- Find the file that has an entry: `grep -l '^## Agriculture' /workspace/reference/technologies/*.md`

## Recorded turns
Each `/workspace/records/turn-<N>` folder is one processed refresh. The newest folder is the latest recorded refresh, and the current turn may not be recorded yet. Events inside keep their original event-turn keys, so a folder can hold events from an earlier turn.

These sections are not in your prompt. Read them from the records when you need them:
{{#omitted}}
- {{title}}: {{files}}
{{/omitted}}
{{#inPrompt}}

These sections are already in your prompt for the latest turn. Read their record files for earlier turns, or where the prompt points to them: {{inPrompt}}.
{{/inPrompt}}

Every recorded turn stays readable. You choose whether to read events, and which turns, categories, and portions of them to read.
`/workspace/records/CATALOG.md` lists the recorded turns and the gaps between them, the full section index, any briefings, and file sizes. Open it when you need any of these, such as before reading an earlier turn.
{{#guide}}

## Guide: `/workspace/game/AGENTS.md`
{{#writable}}
You may edit this guide. Every agent of your civilization follows it. Your edits will appear in the next round.
{{/writable}}
{{^writable}}
This guide is read-only for you.
{{/writable}}
{{#empty}}
It is empty.
{{/empty}}
{{^empty}}
Its current text is below (don't re-read the file):

````markdown
{{content}}
````
{{/empty}}
{{/guide}}
