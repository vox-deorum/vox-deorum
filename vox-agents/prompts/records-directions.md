# Records
Your workspace holds the game's records and your civilization's notes. Use bash to read them and to write where you have access.

## Folders
| Folder | Access | Holds |
| --- | --- | --- |
| `/workspace/records` | read-only | Complete reports, events, and briefings for each processed turn, written by the host. |
| `/workspace/reference` | read-only | Game technologies, policies, buildings, and units with their tooltips, one `.md` and `.json` pair per era. |
{{#game}}
| `/workspace/game` | {{#writable}}writable{{/writable}}{{^writable}}read-only{{/writable}} | Notes shared by every agent of your civilization in this game. They persist across turns. |
{{/game}}
{{#shared}}
| `/workspace/shared/{{name}}` | {{#writable}}writable{{/writable}}{{^writable}}read-only{{/writable}} | General lessons and references that outlive this game, seen by other games and seats. |
{{/shared}}
| `/tmp` | writable | Scratch space for your civilization's agents, kept for this game. |

Files written anywhere else disappear after each command.

## Reference
The reference is one folder per category (`technologies`, `policies`, `buildings`, `units`) holding a Markdown and a JSON file per era: `ancient`, `classical`, `medieval`, `renaissance`, `industrial`, `modern`, `atomic`, `information`, and `other`. Entries with no era, such as starting units, are in `ancient`, and entries with an unknown era are in `other`. Read only the category and era you need; when the era is unknown or you are following a `Replaces` entry, search every era file of the category.

Each Markdown file opens with the category title and has one `## <Name>` heading per entry, followed by compact facts and a `### Help` section with the game's tooltip. Within a file, entries follow cost and name order, or branch, level, and name for policies. Entries that share a name each get a suffix, such as `## Longswordsman (England)`. The JSON twin is an array with `Name`, gameplay facts, and `Help`; internal `Type`, policy `Level`, and the era are omitted, since the file names the era. A unique unit or building names the standard one it replaces. Technology entries list what each technology unlocks.

- List the names in one era: `grep '^## ' /workspace/reference/units/ancient.md`
- Read one whole entry, up to the next heading: `awk '/^## /{p=($0=="## Agriculture")} p' /workspace/reference/technologies/ancient.md`
- Or select it from the `.json` twin: `jq '.[] | select(.Name == "Agriculture")' /workspace/reference/technologies/ancient.json`
- Find which era files of a category name an entry: `grep -l '^## Agriculture' /workspace/reference/technologies/*.md`

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
Open `/workspace/records/CATALOG.md` only when you need the full section index, gaps between turn folders, briefings, or file sizes.
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
