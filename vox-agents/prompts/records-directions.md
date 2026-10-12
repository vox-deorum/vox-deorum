# Records
Your workspace holds the game's records and your civilization's notes. Use bash to read them and to write where you have access.

## Folders
| Folder | Access | Holds |
| --- | --- | --- |
| `/workspace/records` | read-only | Complete reports, events, and briefings for each processed turn, written by the host. |
| `/workspace/reference` | read-only | Game database listings (technologies, policies, buildings, units), each as `.md` and `.json`. |
{{#game}}
| `/workspace/game` | {{#writable}}writable{{/writable}}{{^writable}}read-only{{/writable}} | Notes shared by every agent of your civilization in this game. They persist across turns. |
{{/game}}
{{#shared}}
| `/workspace/shared/{{name}}` | {{#writable}}writable{{/writable}}{{^writable}}read-only{{/writable}} | General lessons and references that outlive this game, seen by other games and seats. |
{{/shared}}
| `/tmp` | writable | Scratch space for your civilization's agents, kept for this game. |

Files written anywhere else disappear after each command.

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
