### Prompt for Generating Markdown Documents

- Read through each JSON file in `mcp-server/docs/events/json` and dispatch a subagent for it
  - Do not batch them
- Review the source code that triggers the event
- For each event, generate a Markdown document in `mcp-server/docs/events/md` that has the following sections:

```
# Overview
# Event Triggers
# Parameters
# Event Details
# Technical Details
```

- Do not add or remove sections from it
- When dispatching subagents, send them these exact instructions

### Prompt for Evaluating Markdown Documents

- Read through each JSON file in `mcp-server/docs/events/json` and dispatch a subagent for it
  - Do not batch them
  - Review the source code that triggers the event
  - For each event, review the Markdown document in `mcp-server/docs/events/md`
  - Fact check if all content in the document is correct, particularly the parameters
  - If you identify any issues, edit the document in place
- When dispatching subagents, send them these exact instructions

### Prompt for Generating Event Definitions

- Read through each MD file in `mcp-server/docs/events/md` and dispatch a subagent for it
  - Do not batch them
- For each event, generate a Zod `z.object({})` definition TypeScript file in `mcp-server/src/knowledge/schema/events` and export it so that
  - Strictly follow the order and type of event arguments
  - The exported name must exactly match the event name
  - Use PascalCase naming convention with sensible/reasonable names for each argument
  - If an argument is an ID (e.g. PlayerID), name it with that suffix
  - Add comments to the exported object and member definitions
  - Do not add extra definitions/types/whatever, do not overthink
  - When dispatching subagents, send them these exact instructions
