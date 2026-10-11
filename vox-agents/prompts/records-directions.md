# Records
Your records are files in your workspace. Read them with bash.
- `/workspace/records`: complete reports for each processed turn, written by the host. Read-only.
- `/workspace/reference`: game database listings (technologies, policies, buildings, units), each as `.md` and `.json`. Read-only.

{{#hasTurns}}
Recorded turns: {{turnRanges}}. The latest folder is `/workspace/records/turn-{{latestTurn}}/`.
{{/hasTurns}}
{{^hasTurns}}
No turns are recorded yet.
{{/hasTurns}}
Read `/workspace/records/CATALOG.md` for file sizes, gaps, briefings, and how to read large files in pieces.

These sections are not in your prompt. Read them from the records when you need them:
{{#omitted}}
- {{title}}: {{files}}
{{/omitted}}

Each `turn-<N>` folder is one processed refresh. Events inside keep their original event-turn keys, and the catalog shows gaps between folders.
Every recorded turn stays readable. You choose whether to read events, and which turns, categories, and portions of them to read.
