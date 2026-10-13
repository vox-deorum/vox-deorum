# Records
Your workspace holds the game's records and your civilization's notes. Use bash to read them and to write where you have access.

## Folders
| Folder | Access | Holds |
| --- | --- | --- |
| `/workspace/records` | read-only | Complete reports, events, and any briefings for each processed turn, written by the host. |
| `/workspace/reference` | read-only | Game technologies, policies, buildings, and units with their tooltips, by era, or by branch for policies. |
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
- `technologies/`, `buildings/`, `units/`: one file per era, such as `units/ancient.md` or `buildings/industrial.md`. `other.md` holds entries no technology unlocks, such as great people, faith units, and corporation buildings.
- `policies/`: one file per branch, such as `policies/tradition.md` or `policies/fealty.md`.

Each entry is a `## <Name>` heading with facts and the game's tooltip. Entries that share a name get a suffix, such as `## Longswordsman (England)`. The `.json` twin also lists every gameplay fact.

- List a category's files: `ls /workspace/reference/policies`
- List the names in one file: `grep '^## ' /workspace/reference/units/ancient.md`
- Read one entry: `awk '/^## /{p=($0=="## Agriculture")} p' /workspace/reference/technologies/ancient.md`
- Or from the twin: `jq '.[] | select(.Name == "Agriculture")' /workspace/reference/technologies/ancient.json`
- Find the file that has an entry: `grep -l '^## Agriculture' /workspace/reference/technologies/*.md`

## Recorded turns
{{#hasTurns}}
Recorded turns, the `<N>` in `turn-<N>` paths: {{turnRanges}}. The latest is `/workspace/records/turn-{{latestTurn}}/`.
{{/hasTurns}}
{{^hasTurns}}
No turns are recorded yet.
{{/hasTurns}}
Each `turn-<N>` folder is one processed refresh. Events inside keep their original event-turn keys, so a folder can hold events from an earlier turn.

These sections are not in your prompt. Read them from the records when you need them:
{{#omitted}}
- {{title}}: {{files}}
{{/omitted}}
{{#inPrompt}}

These sections are already in your prompt for the latest turn. Read their record files for earlier turns, or where the prompt points to them: {{inPrompt}}.
{{/inPrompt}}

Every recorded turn stays readable. You choose whether to read events, and which turns, categories, and portions of them to read.
Open `/workspace/records/CATALOG.md` only when you need the full section index, gaps between turn folders, any briefings, or file sizes.
{{#guide}}

## Notes guide: `/workspace/game/AGENTS.md`
{{#writable}}
You may edit this guide. Every agent of your civilization in this game follows it.
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
{{#notes}}

## Latest note: `{{latest.path}}`
Its current text is below (don't re-read the file):

````markdown
{{latest.content}}
````
{{#earlier.length}}

Earlier notes, newest first:
{{/earlier.length}}
{{#earlier}}
- `{{.}}`
{{/earlier}}
{{/notes}}
