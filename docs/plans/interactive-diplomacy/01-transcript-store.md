# Stage 1 — mcp-server: durable conversation transcript store

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Conversation transcripts become **durable** in the mcp-server, surviving a restart, keyed by the game and a **player pair ordered by `playerID`**. There is exactly **one conversation per pair of major-civ players**, so the store needs no thread identity, no thread table, and no status column (specs §6) — the conversation *is* the ordered list of messages between the two players. This stage stands alone at the storage layer: it is verified entirely through tool calls, with no agent or Web changes yet.

The store holds **only the messages** — the two players, each player's role, the speaker, content, message type, turn, timestamp, and optional message metadata in `Payload`. It does **not** store LLM internals (reasoning, scratch state, tool traces), which stay transient in vox-agents. Deal proposal messages store the proposed terms directly in `Payload.Deal`, plus optional proposal-time `Payload.Value1` / `Payload.Value2` snapshots for the two ordered players. Human-side values are left undefined. Legality is not stored; the proposal exists because it was put in the conversation, and enactment re-validates live.

## Work items

1. **`mcp-server/src/knowledge/schema/timed.ts`** — a `DiplomaticMessage` interface extending `TimedKnowledge`, with `Player1ID` / `Player2ID` (`min` / `max` `playerID`), `Player1Role` / `Player2Role` (`human` / `llm`), `SpeakerID`, `MessageType` (`text`, `close`, `deal-proposal`, later deal response markers), and `Content`. Use the inherited `Payload` JSON for optional message metadata. Deal proposals store terms at `Payload.Deal`, and optional proposal-time estimates at `Payload.Value1` / `Payload.Value2`. Do not put LLM internals in `Payload`. Export the type from `schema/index.ts` and add `DiplomaticMessages` to the `KnowledgeDatabase` interface in `schema/base.ts`.
2. **`mcp-server/src/knowledge/schema/setup.ts`** — create the table in `setupKnowledgeDatabase()` via `createTimedKnowledgeTable(db, 'DiplomaticMessages')` with the columns above, the standard timed indexes, and an extra **player-pair index** on `(Player1ID, Player2ID, Turn, ID)` for transcript reads. No status columns — this is `TimedKnowledge`, not `MutableKnowledge`.
3. **`mcp-server/src/tools/actions/append-message.ts`** (new) — an `ActionTool` taking `{ Player1ID, Player2ID, Player1Role, Player2Role, SpeakerID, MessageType, Content, Payload?, Turn? }`, ordering the two player IDs server-side before storage, validating both players are distinct living majors when game state is available, and writing one row via `store.storeTimedKnowledgeBatch('DiplomaticMessages', [...])` with the required `Payload` set to `{}` when omitted. For `deal-proposal` messages, validate that `Payload.Deal` exists; `Payload.Value1` and `Payload.Value2` are optional snapshots and should be undefined for human participants. The **close-conversation special message** is just an append with the close `MessageType` (no separate mechanism). Register the factory in `tools/index.ts`.
4. **`mcp-server/src/tools/knowledge/read-transcript.ts`** (new, with a getter under `knowledge/getters/`) — a read tool taking `{ PlayerA, PlayerB }`, deriving the same ordered player pair, and returning messages ordered by `(Turn, ID)` so both directions read as a single thread. Register it in `tools/index.ts`.

## Reuse

`createTimedKnowledgeTable` / `createTimedKnowledgeIndexes` (`schema/setup.ts`, `schema/table-utils.ts`); `storeTimedKnowledgeBatch` (`knowledge/store.ts`); the `ActionTool` base + `resolveSourceTurn` (`tools/abstract/action.ts`); the `ToolBase` read-tool shape and getter idiom modeled on `get-opinions` / `get-players`; the `toolFactories` registry in `tools/index.ts`.

## Verify

Via MCP client tool calls against a running game (no agent involvement): `append-message` several messages in both directions between two civ `playerID`s (and one close-conversation special message); `read-transcript` returns them in order as one thread whether requested as `{ A, B }` or `{ B, A }`. Stop and restart mcp-server, re-read — the transcript persists. Confirm no thread/status table was created.

## Done when

A conversation between two civs can be appended to and read back as one ordered, durable thread keyed only by game + the player pair ordered by `playerID`, surviving a restart — exercised purely through the new tools.
