# Interactive Diplomacy — Specifications

This plan adds **interactive diplomacy** to Vox Deorum:

- Two major civilizations — each voiced by a **human** or an **LLM** — can open a diplomatic **conversation** with each other.
- Within that conversation either side can **negotiate a deal** that — when both sides agree — is enacted for real in the game.
- Conversations are durable and visible on the Web.
- Whenever a side is an LLM, it is voiced by a **diplomat** agent, with a **negotiator** agent handling deal mechanics behind it.
- The machinery is **direction-agnostic** — human→LLM, LLM→human, and LLM→LLM are one system (§5) — and implementation **starts from human→LLM**.

This document is the specification: *what* we want and the constraints that make it coherent. Design and staged implementation plans come after, in this folder.

## The feature in one paragraph

This walks through the **first phase, human→LLM**; the same flow runs in any direction (§5).

- **Who talks.** Two major civilizations, each voiced by a human or an LLM participant. Every participant is bound to one civilization — a human to their seat whether playing directly or steering a civ in human-control mode.
- **How they start.** From the Web interface (the first surface; an in-game panel comes later) one side opens a conversation thread with the other civilization.
- **Who answers.** When a side is an LLM, that civ's side defaults to the seat's configured **diplomat** agent — the counterpart's only conversational interlocutor, exchanging free-text messages. Because the Web is a local single-operator game/debug surface, the operator may override the voicing agent when opening the conversation.
- **When a deal appears.** When a **deal** is put on the table — because the human proposes one, or the diplomat decides to — the diplomat **hands off to that seat's negotiator** agent: a deal specialist equipped with the deal tools that never handles human input directly. The default flow is a **diplomat⇔negotiator loop** behind the conversation.
- **What a deal is.** A structured proposal shaped exactly like the game's diplomatic trade screen — a list of trade items each side gives (gold, gold-per-turn, resources, cities, open borders, peace, third-party terms, votes, techs, and so on).
- **How it resolves.** The recipient may **accept as-is, present a counter-deal, or reject**. When both sides accept, the deal is enacted for real through a new DLL entrypoint that:
  - honors all *structural* legality (you can only trade what you actually own; peace must be mutual), but
  - **bypasses the AI's political refusal** — the `CvDealAI` valuation that would otherwise make many deals "impossible."
- **What stays untouched.** The normal in-game deal pathway is left completely untouched.
- **What persists.** Conversation transcripts persist in the mcp-server so the Web (and, later, the game) can read them across restarts. Deal proposal messages store the proposed deal directly in `Payload.Deal`, plus optional `Payload.Value1` / `Payload.Value2` proposal-time value or agreeability snapshots for the two ordered players. Human-side values are left undefined. Current legality is always fetched live from the game; successful enactment is recorded as a `deal-enacted` transcript message for orchestration/audit, not as DLL state.

## What we want to achieve

### 1. Conversation: civilizations talk directly to each other

- Interactive diplomacy is a **free-text diplomatic conversation between two major civilizations**, each of which may be voiced by a **human** or an **LLM**. The conversation **reuses and extends** existing systems rather than introducing a parallel one:
  - the **Envoy** system (`LiveEnvoy` / `Diplomat` / `Spokesperson`, `EnvoyThread`), and
  - the existing web chat surface (`/api/agents/chat`, `/api/agents/message`, the Vue chat components).
- Every participant — human or LLM — is **always bound to a player/civ**. Diplomacy is therefore inherently civ-to-civ: each side speaks *as* its civilization to *another* civilization. A human is bound to their seat in both regular human play (full control) and human-control mode (strategist seat).
- The design is **direction-agnostic** — human→LLM, LLM→human, and LLM→LLM run through the same machinery (§5) — but the build is phased. **We start from human→LLM**: a human opens a conversation with an LLM-played civ, the easiest direction to build and debug end to end.
- The first surface is the **Web** — the easiest place to build and debug the full conversation and deal flow. An in-game diplomacy panel is a later phase (§9), not a separate system.
- Whenever a side is an LLM, its side of the conversation defaults to the **diplomat agent** chosen by that seat's config (§7), so the LLM normally speaks with its configured persona and setup. Because this is a local single-operator game/debug surface, the Web may allow an explicit voicing-agent override. Deal mechanics are handled by a separate **negotiator agent** behind the diplomat (§3, §7), again defaulting from seat config.

### 2. Identity and seating

- Every diplomatic actor is a **major civilization**. The agent layer is major-civ-only; City-States are out of scope. Conversations are keyed by an initiator player and a target player.
- Actor → player mapping (one rule covering human→LLM, LLM→human, and LLM→LLM symmetrically):
  - a **human** actor maps to their seat's `playerID`;
  - an **LLM** actor maps to the `playerID` whose seat config names the diplomat and negotiator.
- Today's `EnvoyThread` carries a single `playerID` plus a `userIdentity` describing the other party. A conversation keyed by a symmetric initiator/target *player pair* generalizes this: the thread must carry **both endpoint `playerID`s explicitly** so either side can be human or LLM. This requires a coordinated vox-agents refactor of `EnvoyThread`, chat routes, endpoint labeling, context/parameter resolution, and `getPlayerAssignments` so diplomacy and ordinary envoy/telepathist chats share one endpoint-pair model. Non-diplomacy chats use `-1` as the observer/no-seat endpoint sentinel; durable diplomatic transcript storage remains major-civ-only.

### 3. Deals: structured, like the game's trade screen

#### What a deal is

- A deal is a **structured artifact**, not free text. It carries **two kinds of terms**:
  - **(a) Ordinary trade items** — each belongs to one side and carries its type and type-specific data (a city id; a resource plus quantity and duration; a gold amount; a peace treaty; and so on). These mirror the in-game diplomatic deal screen and map directly onto `CvDeal` / `CvTradedItem` and the per-item `lAdd*Trade` Lua constructors.
  - **(b) Promise commitments** — a separate list where one side pledges a diplomatic promise to the other (§ Promises as deal terms). These are a Vox-Deorum/interactive-only addition that does **not** go through the `TradeableItems` enum.
- The deal model supports the full set of in-game trade items the game already understands (the `TradeableItems` enum), so negotiation can express anything the underlying deal system can — and, with promise commitments, more besides. This includes **mixed deals** the stock screen discourages:
  - a peace treaty *combined with* an exchange of items rather than a one-sided capitulation, or
  - an item exchange *combined with* a promise (e.g. peace + "stop spying on me" + a resource) in a single agreement.

#### Promises as deal terms

- Every diplomatic **promise** the game tracks in `CvDiplomacyAI` is tradeable on the agent path — **only there**. The full set:
  - **Military** — "won't attack / move troops away"
  - **Expansion** — "don't settle near me"
  - **Border** — "don't buy plots near my cities"
  - **No-Convert** — "don't spread religion"
  - **No-Digging** — "don't dig my antiquity sites"
  - **Spy** — "stop spying on me"
  - **Bully City-State** — "stop bullying my protected city-state"
  - **Attack City-State** — "don't attack my protected city-state"
  - **Coop War** — "join/honor a cooperative war"
- A promise term is `{ promiser, promiseType, target?, duration? }`.
  - The **promiser** is the side making the pledge — the player whose `CvDiplomacyAI` state is set toward the recipient.
  - Promises are one-sided per term, but a deal may stack several (one or both ways).
- **Enactment** of the eight standing promises sets real diplomacy state — `SetXxxPromiseState(recipient, PROMISE_STATE_MADE)` plus `SetXxxPromiseTurn` — preserving the game's existing side-effects:
  - Spy → re-evaluate spies via `EvaluateSpiesAssignedToTargetPlayer`;
  - No-Convert / No-Digging → `SetPlayerAskedNotToConvert` / `SetPlayerAskedNotToDig`.
- **Coop War** is the one structurally-different promise:
  - it is three-party (the two sides agree to war a **target**), so it requires a `target`;
  - it lives in the game's already-saved cooperative-war system (`CoopWarStates` / `m_aaeCoopWarState`);
  - it is enacted via `SetCoopWarState(ally, target, COOP_WAR_STATE_PREPARING)` rather than a promise-state setter.
- Because every promise writes state the game already persists:
  - **no new save fields** are introduced, and nothing is added to the `TradeableItems` enum or its serialization;
  - once made, a promise's **honoring and expiry are governed by the game's existing `CvDiplomacyAI` timers and break-detection** (e.g. a later declaration of war marks the military promise broken) — exactly as for a promise made through normal diplomacy, not by any deal-item duration.

#### Presenting, accepting, countering, rejecting

- A deal enters the conversation through the **diplomat**, never around it, by one of two paths:
  - **Human proposes or counter-proposes** → the diplomat **sees it first** and **forwards it to the negotiator** with a short **briefing** framing the conversational context — what the human is after, the tenor of the exchange, anything the negotiator (which never reads the free-text thread) would otherwise miss.
  - **Diplomat itself decides** to put a deal on the table → it **proposes** one to the negotiator directly.
- Either way, the negotiator inspects, values, and shapes the deal with its tools, then returns its move to the diplomat, which surfaces it to the human.
  - The negotiator never reads or replies to human free-text.
  - The **diplomat sees every deal as it moves back and forth** — including the negotiator's counters and the per-term estimates — so it can voice each move faithfully and keep its running intelligence current.
- Either side may, at any point, **present a deal**. The recipient may:
  - **Accept as-is** — both sides have now agreed; the deal is enacted (§4).
  - **Counter** — present a modified deal back, which the other side then accepts, counters, or rejects.
  - **Reject** — the proposal is declined; the conversation continues.
- These moves are transcript messages, not hidden state. A proposal or counter carries its structured terms in `Payload.Deal`; an accept or reject references the proposal message ID it answers. A successful enactment is recorded as a special `deal-enacted` message carrying `Payload.ProposalMessageID`. The current deal state is derived by reducing the append-ordered transcript, keeping the store append-only and status-free.

#### Where deals are shown and stored

- The deal surface:
  - **reuses the game's existing diplomatic deal screen in-game** (a later phase), and
  - **recreates that screen on the Web** for the first phase — showing both sides' item tables and, per item, whether it is structurally legal and (if not) why (sourced from `IsPossibleToTradeItem` / `GetReasonsItemUntradeable`).
- Deals are **stored as proposals, checked as live game state**:
  - the transcript stores the proposed terms directly in `Payload.Deal`;
  - proposal messages may also store `Payload.Value1` / `Payload.Value2`, the value or agreeability snapshot seen by player 1 and player 2 when the proposal was made; human-side values are undefined;
  - the transcript does not store legality or live DLL state. For display, a proposal is simply a proposal that exists in the conversation; when current legality matters, the deal is reconstructed and inspected in the game on demand (§6). `deal-enacted` records that orchestration succeeded for a proposal; it does not replace live game inspection.

### 4. Rule boundary: bypass political refusal, honor structural legality

- The point of agent-mediated deals: let humans and LLMs strike bargains the stock diplomacy AI would never make — **without** turning the game into a sandbox where impossible trades happen.
- The boundary is drawn by *where a check lives in the code*, not by intent:
  - everything in `CvDeal::IsPossibleToTradeItem` is **honored**;
  - everything in `CvDealAI` is **bypassed**.

#### Honored: structural legality

- A trade item must pass the game's existing structural checks in `CvDeal::IsPossibleToTradeItem`, reused unchanged via `AreAllTradeItemsValid()`. These checks, which live there:
  - you can only trade what you actually possess (`getNumResourceAvailable` ≥ quantity);
  - a city must exist, be yours, and not be your capital — and (outside a peace deal) must not be sapped, blockaded, or recently damaged;
  - a luxury can't be imported in duplicate (except by the Netherlands) and can't be a banned luxury;
  - a city buyer needs an embassy in peacetime;
  - peace requires the two sides to be at war and is mutual;
  - resource quantities and durations must be valid;
  - the trade must be between two distinct, living major civs.

#### Validated as human-to-human

- Today `CvDeal::IsPossibleToTradeItem` computes `bHumanToHuman` internally from `isHuman(ISHUMAN_AI_DIPLOMACY)` for both players — so an agent deal with an AI-played seat would *not* be treated as human↔human. The feature **exposes that internal classification as a caller-controlled override**: `IsPossibleToTradeItem` and `AreAllTradeItemsValid` each gain a **defaulted `bTreatAsHumanToHuman` parameter**. Left at its default the function reproduces the existing computed value — so every stock caller (the normal deal screen) is unchanged — while the agent entrypoint passes `true`, evaluating the structural guards that branch on `isHuman` in their *most permissive* form.
- This means the AI-only structural restrictions do **not** apply to agent deals (including LLM↔LLM):
  - one city per player per deal,
  - no peacetime selling of self-founded cities,
  - the `DEALAI_DISABLE_CITY_TRADES` mod toggle,
  - and other `!bHumanToHuman` gates that live in `IsPossibleToTradeItem`, such as denouncement-based blocks where the stock screen applies them.
- Every agent deal thus gets the same latitude a human↔human deal would have. The always-on structural guards above (duplicate-luxury import, banned luxuries, capital, ownership, quantity, etc.) still apply regardless.

#### Bypassed: everything in `CvDealAI`

- The AI's opinion-based "I won't accept these terms" valuation — which returns the `INT_MAX` sentinel and drives outright AI rejection — is simply **never consulted** on the agent path; acceptance is decided by the negotiation itself.
- A few *anti-exploit* guards also live in this valuation layer rather than in `IsPossibleToTradeItem`:
  - the last-copy-of-a-strategic-resource guard, and
  - the last-luxury-while-unhappy guard,
  - both implemented as `INT_MAX` returns inside `CvDealAI::GetResourceValue`.
- Because v1 bypasses the entire valuation, **these guards are bypassed too — and this is intended.** Agents may trade away a last strategic resource or a last luxury; that latitude is exactly the point of the feature.
- "Bypassed" means *for acceptance*. The same `CvDealAI` valuation is still read **read-only, to produce the value estimates surfaced to the agents** (§ Deal valuation visible to both agents). Consulting it to *inform* a human or LLM and consulting it to *gate* enactment are different things: the agent path never lets valuation decide acceptance, but it does let the agents see what the game thinks each item is worth.

#### Mechanism: a new, additive DLL entrypoint

- The enactment path the human trade screen already uses (`AreAllTradeItemsValid()` → `FinalizeDealValidAndAccepted` → `ActivateDeal`) does **not** call `CvDealAI` at all — acceptance is a parameter the caller passes in.
- The feature adds a new Lua-exposed function, a sibling of the existing accept path, that:
  - takes a complete structured deal object and builds a `CvDeal`,
  - validates it structurally by calling `AreAllTradeItemsValid(bTreatAsHumanToHuman = true)` (the defaulted override above), and
  - activates it with acceptance already decided.
- **The `CvDealAI` valuation logic is left completely untouched, and the normal in-game deal pathway behaves exactly as before.** The shared-function change is the *defaulted* `bTreatAsHumanToHuman` parameter on `IsPossibleToTradeItem` / `AreAllTradeItemsValid` and the matching inspection/reason path, with the default reproducing the prior computation. We add an entrypoint; we do not change the behavior of the existing ones.
- `EnactAgentDeal` does two things in one call:
  - finalizes the `CvDeal` of ordinary trade items (as above), **and**
  - applies the deal's **promise commitments** by calling the diplomacy setters directly — `SetXxxPromiseState` / `SetXxxPromiseTurn` for the eight standing promises and `SetCoopWarState` for Coop War.
- The whole entrypoint is gated behind `MOD_ACTIVE_DIPLOMACY`, so promises are reachable only here, never on the stock screen.
- Promise legality is a **light structural check** done in the entrypoint — it does **not** route through `IsPossibleToTradeItem`, since promises are not `TradeableItems`:
  - distinct living major civs;
  - not already in `PROMISE_STATE_MADE` for that pair;
  - Coop War needs a valid target.

### Deal valuation visible to both agents

- Neither agent should bargain or brief blind. For any deal under discussion, **both the negotiator and the diplomat** can see, **per term, an estimate** of worth.
  - It is returned by the same read-only **inspect-deal** tool that already reports structural legality — so a single call yields legality *and* estimates together.
  - The negotiator uses the estimates to inspect, counter, and accept; the diplomat uses them to write an informed briefing and voice the deal honestly to the human as it moves back and forth.
- Two kinds of estimate, matching the two kinds of term:
  - **Trade items** are valued with the game's own AI valuation, `CvDealAI::GetTradeItemValue`, exposed read-only and computed **both directions** (what it's worth if I give it vs. if I receive it). This reuse is purely additive — a new Lua getter looping the proposed deal's items — and never touches the enact path, which still bypasses `CvDealAI` for acceptance.
  - **Promises** have no trade valuation in the game, so we substitute **agreeability** — how willing the in-game AI would be to make this promise. Rather than computing a verdict in the DLL (which would diverge from Vox Populi and break upstream merge-compatibility), the negotiator **reasons over the AI's raw decision inputs**: approach, opinion, trust/untrustworthiness, broken/ignored-promise history, victory competition — most already surfaced by mcp-server (`get-opinions`, `get-players`, `get-diplomatic-events`). No new `IsXxxAcceptable` logic is added.
- All of this is **advisory only.** Estimates inform the negotiator's inspect/counter/accept reasoning; authority to accept, counter, or reject stays in the negotiator agent (§7), and the game never refuses a deal on valuation grounds on the agent path.

### 5. Initiation directions and configurability

- The spec covers **all initiation directions**, gated by configuration, even though implementation is phased:
  - **human→LLM** (first);
  - **LLM→human** — a diplomat tool that opens a conversation or sends a proposal to a human, who is notified;
  - **LLM→LLM** — peer diplomats and negotiators bargaining with each other.
- **Config controls which directions are live.** A seat (or the session) can be configured to enable or disable initiating diplomacy, accepting incoming diplomacy, and which directions are in play. The exact flag shape is settled in design, but the spec requires that none of the three directions is hard-wired on or off.
- Diplomacy a strategist or diplomat starts is a **tool** the LLM may choose to use (subject to config), not an automatic behavior — consistent with how agents already opt into actions via tools.

### 6. Storage and sharing: durable transcripts, live deals

#### Durable transcripts in the mcp-server

- **Conversation transcripts are durable and live in the mcp-server.** The mcp-server stores *only the messages* — content, speaker, participant roles, turn, timestamp, and optional message payload.
- There is exactly **one conversation per pair of major-civ players** in a game, so the store needs **no thread identity, no thread table, and no status column**:
  - a message is keyed by the game and a **player pair ordered by `playerID`** (`Player1ID = min(playerID)`, `Player2ID = max(playerID)`), plus the speaker for each row;
  - the conversation *is* the ID-ordered list of appended messages between them.
- The transcript message type enum is exactly: `text`, `close`, `deal-proposal`, `deal-counter`, `deal-accept`, `deal-reject`, `deal-enacted`.
- This persists across restarts and is what the Web reads. It does **not** store LLM internals (reasoning, agent scratch state, tool traces), which stay transient in vox-agents and may be lost between restarts. Deal proposal messages carry `Payload.Deal` and may carry `Payload.Value1` / `Payload.Value2`, but not legality or live DLL state.
- Both participant visibility flags are set on every transcript row. The transcript is private to the two civs, but either side can read the same ordered conversation.
- `append-message` is an archival write only. It does not stream responses, notify clients, run agents, enact deals, or decide whether a deal is current/accepted. Web and agent orchestration layers perform those actions separately, then append the resulting transcript messages.

#### Threads live only in vox-agents

- The `EnvoyThread`-style working structure — thread id, open/closed bookkeeping, agent scratch — stays in vox-agents.
- vox-agents treats the mcp-server message store as the source of truth for the transcript, writing each message through mcp-server tools rather than holding chat only in memory — replacing today's in-memory `chatSessions` map.

#### Deal proposals are stored; current checks are fetched

- Because game state can move on, the current deal view is read on demand from civ5-dll via a new mcp-server tool that reconstructs and inspects `Payload.Deal`.
- Storage holds the proposal terms in `Payload.Deal` and optional proposal-time `Payload.Value1` / `Payload.Value2` snapshots only. It does not store legality or reasons. Successful orchestration appends `deal-enacted` with `Payload.ProposalMessageID`, while current game state remains live.

#### No real-time Web⇄game sync

- The Web and the game share *storage* (the durable transcript) and *infrastructure* (agents, mcp tools, the deal system); they do not need to mirror each other live.
- The Web reaches the mcp-server **through vox-agents** — the Web talks only to the vox-agents REST backend, which calls mcp-server tools — so there is no direct Web-to-mcp-server channel to build.

### 7. Agentic design: a diplomat front and a negotiator behind it

#### Two cooperating agents: diplomat + negotiator

Each LLM player's diplomacy is handled by **two cooperating agents**, both extending the existing Envoy pattern rather than overloading the strategist's turn loop:

- A **diplomat** — the human's only conversational counterpart, extending the existing `Diplomat` envoy.
  - It exchanges free-text messages, owns the thread, and (as today) gathers intelligence from the conversation as it goes.
  - Beyond its existing conversational tools (`get-briefing`, `get-diplomatic-events`, and the like), it gains **three new tools**:
    - **propose-deal** — hand a deal the diplomat itself decided on off to the negotiator;
    - **forward-deal** — when the human proposes or counter-proposes, pass that deal to the negotiator together with a short briefing of the conversational context;
    - **close-conversation** — end the exchange.
  - It **sees the deal at every step** — the human's proposal, the negotiator's counters, and the per-term estimates (§ Deal valuation visible to both agents) — so it can relay each move faithfully and keep gathering intelligence.
  - Closing is recorded as a **special message** in the transcript rather than a status flag, and carries a game implication: once the diplomat closes, the conversation **cannot be reopened on the same turn** — the counterpart must wait until a later turn to talk again, giving an LLM diplomat a real way to walk away from a fruitless or hostile exchange.
- A **negotiator** — a deal specialist equipped with the deal tools: inspect a proposed deal against the civ's strategy and persona, present a counter, accept, or reject, and drive enactment.
  - To inspect, it fetches **per-term value and agreeability estimates** from the unified mcp-server **inspect-deal** tool (which now returns legality + estimates in one call, § Deal valuation visible to both agents) and weighs them against the civ's strategy.
  - Because it never reads the conversation, it is grounded two ways:
    - it receives the diplomat's **briefing** with each forwarded deal;
    - it carries its own **`get-briefing`** and **`get-diplomatic-events`** tools so it can read the same game and diplomatic state the diplomat sees.
  - It is invoked *by the diplomat* as an agent-tool and **never handles human free-text directly.**
  - The default runtime shape is a **diplomat⇔negotiator loop**: the diplomat relays the human's intent (with a briefing) in; the negotiator returns its move out.

#### Per-seat agent selection

- **Each LLM seat chooses its default diplomat and negotiator agents the same way it chooses its strategist today**, and those agents may have **different agentic setups** — different prompts, tools, even different models via the existing per-agent model-override map. The local Web debug surface may override the voicing agent for a conversation, but seat config remains the displayed/default choice.
- This is the same per-seat selection model as strategists, and is expected to require a **refactor that generalizes per-seat agent assignment** beyond just the strategist:
  - adding `diplomat` / `negotiator` fields to the seat config;
  - resolving the *target* seat's configured agents from the conversation as the default, while honoring the local operator override.

#### Authority lives in the agent

- **Authority is a property of the chosen negotiator agent, not a separate config knob.** How much latitude a negotiator has to accept, counter, or reject — and whether it consults anyone before committing — is baked into that agent's design.
- A seat selects the behavior it wants simply by selecting the agent. There is no separate ratification-threshold setting.

### 8. Pacing and lifecycle

- **Human↔LLM conversations: the game is already paused.** A human is only interacting because their own decision point has paused the game (the existing human-control and pacing pause), so a human-driven conversation and any deal agreed in it happen against a stable game state by default — no new pause machinery is needed for the common case.
- **A conversation may stretch across turns.** Even a human conversation can outlive the pause that started it, and the game state it was reasoning about can move on. The **diplomat's design must account for this**:
  - re-reading current game and diplomatic state as needed;
  - not assuming the world is frozen for the life of the thread;
  - a deal is validated and enacted against the game state *at enactment time*, not at proposal time.
- **LLM↔LLM dialogues do not pause the game or the strategist by default.** Peer negotiations run alongside continued auto-play; they must not block the turn loop.
- **A conversation ends explicitly, not as a side effect of a deal.** Rejecting or even accepting a proposal does not close it.
  - The diplomat closes it via `close-conversation` (or the human closes it on the Web), which writes the closing special message from §7.
  - That close locks the conversation for the rest of the current turn, so neither side can reopen it until a later turn.
  - vox-agents derives open/closed status from the presence and turn of that message.

### 9. Surface and phasing

- **Web first.** The first version delivers the full conversation, deal negotiation, and real enactment flow on the Web — reusing the existing chat routes and Vue components and recreating the deal screen on the Web.
- **In-game later.** A subsequent phase adds an in-game diplomacy panel. Because the base-game / EUI trade screen is **not vendored in this repo**, the in-game panel is a **new mod UI addon** modeled on the existing human-control panel (`civ5-mod/.../VoxDeorumHumanPanel.lua`: a dormant addon that listens for a `LuaEvents` trigger and emits `Game.BroadcastEvent` on submit), reusing the game's trade screen where feasible.

## Component impact

### `mcp-server`

Durable transcript storage and the deal bridge:

- A single new **messages** table in the per-game knowledge store, keyed by `Player1ID` / `Player2ID` ordered by `playerID`, plus `Player1Role` / `Player2Role` and a speaker column (no thread table or status column — one conversation per major-civ player pair, §6). Transcript order is append `ID`, with `Turn` retained as metadata.
- Tools to **append a message** (including `close` and `deal-enacted` special messages) and **read the transcript** between two civs. `append-message` is archival only and defaults `Turn` to the current server turn when omitted.
- A single read-only **inspect-deal** tool that constructs and queries a proposed deal in the game and returns, **per term in one call**:
  - structural legality and reasons (for trade items), computed under the same `bTreatAsHumanToHuman = true` semantics as enactment;
  - the **AI value estimate both directions** (for trade items, via the new `GetTradeItemValue` getter);
  - **agreeability factors** (for promises, assembled from existing diplomacy/opinion getters).
  - Legality and estimation are unified here — there is no separate estimate tool.
- A non-read-only **enact-agent-deal** tool that calls the new DLL `EnactAgentDeal` function with a complete deal object, passing both the trade items **and the promise commitment list**. The tool is stateless: callers reduce the transcript, guard duplicate UI actions, call enactment, and append `deal-enacted` on success.
- Tools follow the existing `ToolBase` / `LuaFunctionTool` pattern and registry (`tools/index.ts`).

### `vox-agents`

The diplomat and negotiator agents and the per-seat config generalization:

- A **diplomat envoy** extended with **propose-deal**, **forward-deal** (forward a human-proposed/countered deal to the negotiator with a context briefing), and **close-conversation** tools; it also reads the same per-term `inspect-deal` estimates so it can voice deals and brief accurately.
- A new deal-aware **negotiator envoy** invoked by the diplomat as an agent-tool (the diplomat⇔negotiator loop); both registered in the agent registry. Its deal artifact is **promise-aware** (trade items + promise commitments); it fetches per-term **value/agreeability estimates** via the unified mcp-server `inspect-deal` tool, receives the diplomat's briefing with each forwarded deal, and carries **`get-briefing`** / **`get-diplomatic-events`** tools to read game and diplomatic state directly.
- `diplomat` / `negotiator` fields on `PlayerConfig`.
- Refactoring `EnvoyThread`, chat routes, endpoint labeling, context/parameter resolution, and `getPlayerAssignments` together so the target seat's configured diplomat/negotiator can be shown as defaults while still allowing local operator override.
- Rewiring the web chat routes to persist transcripts through the mcp-server tools (the in-memory thread becomes a write-through cache).
- The diplomacy-config surface for which initiation directions are enabled.

### `civ5-dll`

The *only* gameplay code change:

- A new Lua-exposed entrypoint (an `EnactAgentDeal` method exposed in `CvLuaDeal.cpp`) that:
  - builds a `CvDeal`;
  - validates it with `AreAllTradeItemsValid(bTreatAsHumanToHuman = true)` for structural legality — using the **defaulted override** added to `IsPossibleToTradeItem` / `AreAllTradeItemsValid` (default reproduces today's computed value, so stock callers are unchanged), so AI-only structural restrictions don't gate agent deals — §4;
  - activates it via the existing `FinalizeDealValidAndAccepted` / `ActivateDeal` with acceptance pre-decided — **without** invoking `CvDealAI`;
  - then **applies the deal's promise commitments** by calling the diplomacy setters directly — `SetXxxPromiseState` / `SetXxxPromiseTurn` (plus existing side-effects) for the eight standing promises, and `SetCoopWarState` for Coop War — all gated behind `MOD_ACTIVE_DIPLOMACY`.
- Inspection reuses `lIsPossibleToTradeItem` / `lGetReasonsItemUntradeable`, which already exist on the Lua-exposed `CvDeal` (`CvLuaDeal.cpp`) but are not yet wrapped by mcp-server — **plus a new read-only getter** that wraps `CvDealAI::GetTradeItemValue` per item, both directions, for the value estimates. The legality/reason wrapper passes the same `bTreatAsHumanToHuman = true` override so the screen's per-term legality matches what enactment will allow.
- The **defaulted `bTreatAsHumanToHuman` override** on `IsPossibleToTradeItem` / `AreAllTradeItemsValid`, plus the matching inspection/reason wrapper path (§4): a backward-compatible signature extension whose default reproduces the existing computed value, so the stock deal screen and AI paths are unchanged. `CvDealAI` is untouched.
- **No `TradeableItems` enum change, no new save fields, and no new acceptability/valuation logic** (promise agreeability is factor-based reasoning in the agent, § Deal valuation visible to both agents). Requires a DLL rebuild and a version bump; the normal pathway behaves exactly as before.

### Web UI (`vox-agents/ui`)

- Recreate the diplomatic deal screen as a Vue component embedded in the chat thread: both sides' item tables **plus promise terms**, per-term legality and the **value estimate / agreeability factors** shown alongside, and Accept / Counter / Reject actions.
- Surface incoming LLM-initiated conversations and proposals.

### `civ5-mod`

- Later phase only: a new in-game diplomacy panel addon modeled on the human-control panel.

### `bridge-service`

- Expected unchanged: Lua execution and `Game.BroadcastEvent` already carry everything needed.

## Out of scope

- A **real-time synchronization** layer between the Web and the in-game client. They share storage and infrastructure; they do not mirror each other live.
- **Diplomacy with City-States or other non-major civs.** The agent layer is major-civ-only.
- **Relaxing the always-on structural guards inside `IsPossibleToTradeItem`** (duplicate-luxury import, banned luxuries, capital, ownership, quantity, embassy-for-city, sapped/damaged cities, and similar). v1 honors these as structural and unchanged; relaxing a specific one would require threading a new override through the function — a larger, riskier change deferred beyond v1. (The valuation-layer anti-exploit guards — last strategic-resource copy, last luxury while unhappy — are *not* in this category: they live in `CvDealAI` and are bypassed by design, per §4.)
- **Changing or branching the normal in-game deal or AI-valuation pathway.** The feature is additive apart from backward-compatible inspection/enactment signature extensions: a *defaulted* `bTreatAsHumanToHuman` parameter on `IsPossibleToTradeItem` / `AreAllTradeItemsValid` and the matching reason/inspection path whose default reproduces the existing computation, so no stock caller's behavior changes and `CvDealAI` is untouched. No stock-path logic is branched.
- **The in-game diplomacy panel**, which is phased later — explicitly planned, not abandoned, but not delivered in v1.
- **New DLL acceptability or valuation logic for promises.** Promises are *enacted* through existing setters, but their "agreeability" is **factor-based reasoning by the negotiator agent**, not a new in-game verdict — keeping the DLL merge-compatible with upstream Vox Populi.
- **Representing promises as `TradeableItems`.** Promises are deal terms applied directly at enactment, not `CvTradedItem`s; the trade-item enum, its serialization, and the stock deal screen are untouched.

## Success criteria

- From the Web, a human seated as a civilization can open a conversation with an LLM-played civ, exchange messages, and the LLM responds in the voice of that seat's configured diplomat agent by default, with a local operator override available for debugging.
- Either side can present a structured deal mirroring the game's trade screen; the recipient can accept, counter, or reject; and a deal accepted by both sides is **enacted for real in the game** — items change hands — for deals the stock AI would have refused on political grounds, while structurally-illegal items are still rejected with a reason.
- A deal may include **any of the nine promises** (Coop War targeting a third party); an accepted promise is written to real diplomacy state and thereafter **behaves like an in-game promise** — honored and broken by the game's existing rules (e.g. broken by a later declaration of war).
- Both the negotiator and the diplomat see **per-term value and agreeability estimates** for a deal under discussion; these inform their reasoning and briefing but **never gate enactment** on the agent path.
- The normal in-game deal pathway and AI valuation behave exactly as before; the agent path is a separate entrypoint, and no `TradeableItems` or save-format change is introduced.
- Conversation transcripts persist in the mcp-server and survive a restart; the Web reads them through vox-agents; proposal messages store `Payload.Deal`, `deal-enacted` records successful orchestration, and current legality/game state are fetched live from the game.
- Each LLM seat can be configured to use a different diplomat and negotiator agent (and model), and initiation can be enabled or disabled per direction — human↔LLM and, in later phases, LLM↔LLM.
