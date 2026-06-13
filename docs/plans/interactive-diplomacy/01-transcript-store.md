# Stage 1 — mcp-server: durable conversation transcript store

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Conversation transcripts become **durable** in the mcp-server, surviving a restart, keyed simply by the game and the two participant `playerID`s. There is exactly **one conversation per pair of major civs**, so the store needs no thread identity, no thread table, and no status column (specs §6) — the conversation *is* the ordered list of messages between the two civs. This stage stands alone at the storage layer: it is verified entirely through tool calls, with no agent or Web changes yet.

The store holds **only the messages** — role/speaker, content, type, turn, timestamp, and an opaque reference for messages that carry a deal proposal. It does **not** store LLM internals (reasoning, scratch state, tool traces), which stay transient in vox-agents.

## Work items

1. **`mcp-server/src/knowledge/schema/timed.ts`** — a `DiplomaticMessages` interface extending `TimedKnowledge`, with `FromPlayerID` / `ToPlayerID` (number), `MessageType` (text — ordinary message vs. the close-conversation special message vs. a deal-proposal marker), `Content` (text), and an optional opaque `DealRef` (text — never a frozen deal copy, specs §6). Export the type from `schema/index.ts` and add it to the `KnowledgeDatabase` interface in `schema/base.ts`.
2. **`mcp-server/src/knowledge/schema/setup.ts`** — create the table in `setupKnowledgeDatabase()` via `createTimedKnowledgeTable(db, 'DiplomaticMessages')` with the four columns above (+ `DealRef` nullable), the standard timed indexes, and an extra **player-pair index** on `(FromPlayerID, ToPlayerID, Turn)` for the per-pair read. No status/version columns — this is `TimedKnowledge`, not `MutableKnowledge`.
3. **`mcp-server/src/tools/actions/append-message.ts`** (new) — an `ActionTool` taking `{ FromPlayerID, ToPlayerID, MessageType, Content, DealRef?, Turn? }` that writes one row via `store.storeTimedKnowledgeBatch('DiplomaticMessages', [...])`. The **close-conversation special message** is just an append with the close `MessageType` (no separate mechanism). Register the factory in `tools/index.ts`.
4. **`mcp-server/src/tools/knowledge/read-transcript.ts`** (new, with a getter under `knowledge/getters/`) — a read tool taking `{ PlayerA, PlayerB }` that returns the **ordered** messages between the two civs (both directions), so the conversation reads as a single thread regardless of who spoke. Register it in `tools/index.ts`.

## Reuse

`createTimedKnowledgeTable` / `createTimedKnowledgeIndexes` (`schema/setup.ts`, `schema/table-utils.ts`); `storeTimedKnowledgeBatch` (`knowledge/store.ts`); the `ActionTool` base + `resolveSourceTurn` (`tools/abstract/action.ts`); the `ToolBase` read-tool shape and getter idiom modeled on `get-opinions` / `get-players`; the `toolFactories` registry in `tools/index.ts`.

## Verify

Via tool calls against a running game (no agent involvement): `append-message` several messages in both directions between two civ `playerID`s (and one close-conversation special message); `read-transcript` returns them in order as one thread. Stop and restart mcp-server, re-read — the transcript persists. Confirm no thread/status table was created.

## Done when

A conversation between two civs can be appended to and read back as one ordered, durable thread keyed only by game + the two `playerID`s, surviving a restart — exercised purely through the new tools.
