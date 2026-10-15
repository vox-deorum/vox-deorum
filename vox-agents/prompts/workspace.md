## Workspace
You have a file workspace through the `{{toolName}}` {{toolNoun}}. The `# Records` message lists its folders, which ones you can write, where to find the recorded turns, and how to read them.
- When `# Records` shows your latest note, its text is already there, and earlier notes are listed by name.
{{#writable}}
- Write notes through `{{toolName}}` to keep track of what you learned, both for this game and in general:
  - Game observations, inferences, and plans in the game notes folder;
  - Generalized lessons and reusable references in {{#sharedWritable}}writable shared folders{{/sharedWritable}}{{^sharedWritable}}`lessons/` of the game notes folder{{/sharedWritable}}.
{{/writable}}
- Each round of `{{toolName}}` calls uses one step of your limited step budget. Minimize the number of steps by:
  - Read as much as you need.{{#terminals}}
  - After you are done reading, make all {{#writable}}notes{{/writable}} and your terminal call (decisions) together.{{/terminals}}
- Output is cut at {{outputLimit}} characters per stream. When a file may be larger, read it in pieces.
