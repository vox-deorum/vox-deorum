# Interactive Diplomacy — Specifications

This plan adds **interactive diplomacy** to Vox Deorum: a human, always seated as a civilization, can open a diplomatic **conversation** with an LLM player and, within that conversation, **negotiate a deal** that — when both sides agree — is enacted for real in the game. Conversations are durable and visible on the Web; each LLM player is voiced by a **diplomat** agent, with a **negotiator** agent handling deal mechanics behind it. The same machinery is designed to support LLM-to-human and LLM-to-LLM diplomacy as well.

This document is the specification: *what* we want and the constraints that make it coherent. Design and staged implementation plans come after, in this folder.

## The feature in one paragraph

A human participant — whether they are playing the game directly or steering a civ in human-control mode — is always bound to one civilization. From the Web interface (the first surface; an in-game panel comes later) they open a conversation thread with another civilization, whose side is voiced by that seat's configured LLM **diplomat** agent — the human's only conversational counterpart, exchanging free-text messages. When a **deal** is put on the table — because the human proposes one, or because the diplomat decides to — the diplomat **hands off to that seat's negotiator** agent, a deal specialist equipped with the deal tools that never handles human input directly; the default flow is a **diplomat⇔negotiator loop** behind the conversation. A deal is a structured proposal shaped exactly like the game's diplomatic trade screen — a list of trade items each side gives (gold, gold-per-turn, resources, cities, open borders, peace, third-party terms, votes, techs, and so on). The recipient may **accept as-is, present a counter-deal, or reject**. When both sides accept, the deal is enacted for real in the game through a new DLL entrypoint that honors all *structural* legality (you can only trade what you actually own; peace must be mutual) but **bypasses the AI's political refusal** — the `CvDealAI` valuation that would otherwise make many deals "impossible." The normal in-game deal pathway is left completely untouched. Conversation transcripts persist in the mcp-server so the Web (and, later, the game) can read them across restarts; deals themselves are live game state, fetched from the game on demand rather than copied into storage.

## What we want to achieve

### 1. Conversation: humans talk directly to LLM players

- A human seated as a civilization can initiate a free-text diplomatic conversation with another major civilization that is played by an LLM. The conversation reuses and extends the existing **Envoy** system (`LiveEnvoy` / `Diplomat` / `Spokesperson`, `EnvoyThread`) and the existing web chat surface (`/api/agents/chat`, `/api/agents/message`, the Vue chat components), rather than introducing a parallel system.
- The human is **always bound to a player/civ.** This holds in both regular human play (full control) and human-control mode (strategist seat). Diplomacy is therefore inherently civ-to-civ: the human speaks *as* their civilization to *another* civilization.
- The first surface is the **Web** — it is the easiest place to build and debug the full conversation and deal flow. An in-game diplomacy panel is a later phase (§9), not a separate system.
- The LLM's side of every conversation is voiced by a **diplomat agent** chosen by that LLM seat's config (§7), not by whatever agent name the client requests — so the LLM speaks with its configured persona and setup. Deal mechanics are handled by a separate **negotiator agent** behind the diplomat (§3, §7).

### 2. Identity and seating

- Every diplomatic actor is a **major civilization**; the agent layer is major-civ-only and City-States are out of scope. Conversations are keyed by an initiator player and a target player.
- A human actor maps to their seat's `playerID`; an LLM actor maps to the `playerID` whose seat config names the diplomat and negotiator. This single rule covers human→LLM, LLM→human, and LLM→LLM symmetrically.
- Today's `EnvoyThread` carries a single `playerID` plus a `userIdentity` describing the other party. A conversation keyed by a symmetric initiator/target *player pair* generalizes this: the thread must carry both endpoint `playerID`s explicitly so either side can be human or LLM. This generalization is part of the vox-agents work (§ Component impact).

### 3. Deals: structured, like the game's trade screen

#### What a deal is

- A deal is a **structured artifact**, not free text. It carries **two kinds of terms**: (a) ordinary **trade items**, each belonging to one side and carrying its type and type-specific data (a city id, a resource plus quantity and duration, a gold amount, a peace treaty, and so on); and (b) a separate list of **promise commitments**, where one side pledges a diplomatic promise to the other (§ Promises as deal terms). The trade items mirror the in-game diplomatic deal screen and map directly onto `CvDeal` / `CvTradedItem` and the per-item `lAdd*Trade` Lua constructors; the promise commitments are a Vox-Deorum/interactive-only addition that does **not** go through the `TradeableItems` enum.
- The deal model supports the full set of in-game trade items the game already understands (the `TradeableItems` enum), so the negotiation can express anything the underlying deal system can — and, with promise commitments, more besides. This includes **mixed deals** the stock screen discourages: a peace treaty *combined with* an exchange of items rather than a one-sided capitulation, or an item exchange *combined with* a promise (for example, peace + "stop spying on me" + a resource) in a single agreement.

#### Promises as deal terms

- Every diplomatic **promise** the game tracks in `CvDiplomacyAI` is tradeable on the agent path — only there. The full set: **Military** ("won't attack / move troops away"), **Expansion** ("don't settle near me"), **Border** ("don't buy plots near my cities"), **No-Convert** ("don't spread religion"), **No-Digging** ("don't dig my antiquity sites"), **Spy** ("stop spying on me"), **Bully City-State** ("stop bullying my protected city-state"), **Attack City-State** ("don't attack my protected city-state"), and **Coop War** ("join/honor a cooperative war").
- A promise term is `{ promiser, promiseType, target?, duration? }`. The **promiser** is the side making the pledge — the player whose `CvDiplomacyAI` state is set toward the recipient. Promises are one-sided per term, but a deal may stack several (one or both ways).
- The eight standing promises are enacted by setting real diplomacy state — `SetXxxPromiseState(recipient, PROMISE_STATE_MADE)` plus `SetXxxPromiseTurn`, preserving the game's existing side-effects (Spy → re-evaluate spies via `EvaluateSpiesAssignedToTargetPlayer`; No-Convert / No-Digging → `SetPlayerAskedNotToConvert` / `SetPlayerAskedNotToDig`). **Coop War** is the one structurally-different promise: it is three-party (the two sides agree to war a **target**) and lives in the game's already-saved cooperative-war system (`CoopWarStates` / `m_aaeCoopWarState`), so it requires a `target` and is enacted via `SetCoopWarState(ally, target, COOP_WAR_STATE_PREPARING)` rather than a promise-state setter.
- Because every promise writes state the game already persists, **no new save fields are introduced** and nothing is added to the `TradeableItems` enum or its serialization. Once made, a promise's **honoring and expiry are governed by the game's existing `CvDiplomacyAI` timers and break-detection** (e.g. a later declaration of war marks the military promise broken), exactly as for a promise made through normal diplomacy — not by any deal-item duration.

#### Presenting, accepting, countering, rejecting

- A deal enters the conversation through the **diplomat**, never around it: when the human proposes a deal, or when the diplomat itself decides to, the diplomat **hands off to the negotiator** (§7). The negotiator inspects, values, and shapes the deal with its tools, then returns its move to the diplomat, which surfaces it to the human. The negotiator never reads or replies to human free-text.
- Either side may, at any point in a conversation, **present a deal**. The recipient may:
  - **Accept as-is** — both sides have now agreed; the deal is enacted (§4).
  - **Counter** — present a modified deal back, which the other side then accepts, counters, or rejects.
  - **Reject** — the proposal is declined; the conversation continues.

#### Where deals are shown and stored

- The deal surface **reuses the game's existing diplomatic deal screen in-game** (a later phase) and **recreates that screen on the Web** for the first phase. The Web deal view shows both sides' item tables and, per item, whether the item is structurally legal and — if not — why (sourced from the game's `IsPossibleToTradeItem` / `GetReasonsItemUntradeable`).
- Deals are **live game state, not stored conversation data.** A deal under discussion is constructed and inspected in the game on demand (§6); the conversation transcript records only that a proposal was made, plus an opaque reference to it, never a frozen copy.

### 4. Rule boundary: bypass political refusal, honor structural legality

The point of agent-mediated deals is to let humans and LLMs strike bargains the stock diplomacy AI would never make — without turning the game into a sandbox where impossible trades happen. The boundary is drawn by *where a check lives in the code*, not by intent: everything in `CvDeal::IsPossibleToTradeItem` is honored; everything in `CvDealAI` is bypassed.

#### Honored: structural legality

- A trade item must pass the game's existing structural checks in `CvDeal::IsPossibleToTradeItem`, reused unchanged via `AreAllTradeItemsValid()`. These are the checks that live there: you can only trade what you actually possess (`getNumResourceAvailable` ≥ quantity); a city must exist, be yours, and not be your capital, and (outside a peace deal) must not be sapped, blockaded, or recently damaged; a luxury can't be imported in duplicate (except by the Netherlands) and can't be a banned luxury; a city buyer needs an embassy in peacetime; peace requires the two sides to be at war and is mutual; resource quantities and durations must be valid; and the trade must be between two distinct, living major civs.

#### Validated as human-to-human

- The new entrypoint classifies both sides as human (`bHumanToHuman = true`) when validating, so the structural guards that branch on `isHuman` are evaluated in their *most permissive* form. This means the AI-only structural restrictions — one city per player per deal, no peacetime selling of self-founded cities, and the `DEALAI_DISABLE_CITY_TRADES` mod toggle — do **not** apply to agent deals (including LLM↔LLM), giving every agent deal the same latitude a human↔human deal would have. The always-on structural guards above (duplicate-luxury import, banned luxuries, capital, ownership, quantity, etc.) still apply regardless.

#### Bypassed: everything in `CvDealAI`

- The AI's opinion-based "I won't accept these terms" valuation — which returns the `INT_MAX` sentinel and drives outright AI rejection — is simply **never consulted** on the agent path; acceptance is decided by the negotiation itself. Note that a few *anti-exploit* guards also live in this valuation layer rather than in `IsPossibleToTradeItem` — notably the last-copy-of-a-strategic-resource guard and the last-luxury-while-unhappy guard, both implemented as `INT_MAX` returns inside `CvDealAI::GetResourceValue`. Because v1 bypasses the entire valuation, **these guards are bypassed too — and this is intended.** Agents may trade away a last strategic resource or a last luxury; that latitude is exactly the point of the feature.
- "Bypassed" means *for acceptance*. The same `CvDealAI` valuation is still read, **read-only, to produce the value estimates surfaced to the negotiator** (§ Deal valuation visible to the negotiator). Consulting it to *inform* a human or LLM and consulting it to *gate* enactment are different things: the agent path never lets valuation decide acceptance, but it does let the negotiator see what the game thinks each item is worth.

#### Mechanism: a new, additive DLL entrypoint

- The enactment path the human trade screen already uses (`AreAllTradeItemsValid()` → `FinalizeDealValidAndAccepted` → `ActivateDeal`) does **not** call `CvDealAI` at all — acceptance is a parameter the caller passes in. The feature adds a new Lua-exposed function, a sibling of the existing accept path, that builds the agreed `CvDeal`, validates it structurally (as human-to-human), and activates it with acceptance already decided. **The normal in-game deal pathway and the `CvDealAI` valuation logic are left completely untouched** — we add an entrypoint, we do not branch inside the existing ones.
- `EnactAgentDeal` does two things in one call: it finalizes the `CvDeal` of ordinary trade items (as above), **and** it applies the deal's **promise commitments** by calling the diplomacy setters directly — `SetXxxPromiseState` / `SetXxxPromiseTurn` for the eight standing promises and `SetCoopWarState` for Coop War. The whole entrypoint is gated behind `MOD_ACTIVE_DIPLOMACY`, so promises are reachable only here, never on the stock screen. Promise legality is a light structural check done in the entrypoint (distinct living major civs; not already in `PROMISE_STATE_MADE` for that pair; Coop War needs a valid target) — it does **not** route through `IsPossibleToTradeItem`, since promises are not `TradeableItems`.

### Deal valuation visible to the negotiator

The negotiator should not bargain blind. For any deal under discussion it can fetch, **per term, an estimate** of worth from the mcp-server — returned by the same read-only **inspect-deal** tool that already reports structural legality, so a single call yields legality *and* estimates together. Two kinds of estimate, matching the two kinds of term:

- **Trade items** are valued with the game's own AI valuation, `CvDealAI::GetTradeItemValue`, exposed read-only and computed **both directions** (what it's worth if I give it vs. if I receive it). This reuse is purely additive — a new Lua getter that loops the proposed deal's items — and never touches the enact path, which still bypasses `CvDealAI` for acceptance.
- **Promises** have no trade valuation in the game, so we substitute **agreeability**: how willing the in-game AI would be to make this promise. Rather than computing a verdict in the DLL (which would diverge from Vox Populi and break upstream merge-compatibility), the negotiator **reasons over the AI's raw decision inputs** — approach, opinion, trust/untrustworthiness, broken/ignored-promise history, victory competition — most of which mcp-server already surfaces (`get-opinions`, `get-players`, `get-diplomatic-events`). No new `IsXxxAcceptable` logic is added.

All of this is **advisory only.** Estimates inform the negotiator's inspect/counter/accept reasoning; authority to accept, counter, or reject stays in the negotiator agent (§7), and the game never refuses a deal on valuation grounds on the agent path.

### 5. Initiation directions and configurability

- The spec covers **all initiation directions**, gated by configuration, even though implementation is phased: **human→LLM** (first), **LLM→human** (a diplomat tool that opens a conversation or sends a proposal to a human, who is notified), and **LLM→LLM** (peer diplomats and negotiators bargaining with each other).
- **Config controls which directions are live.** A seat (or the session) can be configured to enable or disable initiating diplomacy, accepting incoming diplomacy, and which directions are in play. The exact flag shape is settled in design, but the spec requires that none of the three directions is hard-wired on or off.
- Diplomacy a strategist or diplomat starts is a **tool** the LLM may choose to use (subject to config), not an automatic behavior — consistent with how agents already opt into actions via tools.

### 6. Storage and sharing: durable transcripts, live deals

#### Durable transcripts in the mcp-server

- **Conversation transcripts are durable and live in the mcp-server.** The mcp-server stores *only the messages* — role, content, speaker, turn, and timestamp. There is exactly **one conversation per pair of major civs** in a game, so the store needs no thread identity, no thread table, and no status column: a message is keyed simply by the game and the two participant `playerID`s, and the conversation *is* the ordered list of messages between them. This persists across restarts and is what the Web reads. It does **not** store LLM internals (reasoning, agent scratch state, tool traces), which stay transient in vox-agents and may be lost between restarts.

#### Threads live only in vox-agents

- The `EnvoyThread`-style working structure — thread id, open/closed bookkeeping, agent scratch — stays in vox-agents, which treats the mcp-server message store as the source of truth for the transcript and writes each message through mcp-server tools rather than holding chat only in memory, replacing today's in-memory `chatSessions` map.

#### Deals are fetched, not stored

- Because a deal is live game state, the deal shown in a conversation is read on demand from civ5-dll via a new mcp-server tool that constructs and inspects a proposal and returns per-item legality and reasons. Storage holds only an opaque reference, never a copy.

#### No real-time Web⇄game sync

- The Web and the game share *storage* (the durable transcript) and *infrastructure* (agents, mcp tools, the deal system); they do not need to mirror each other live. The Web reaches the mcp-server **through vox-agents** — the Web talks only to the vox-agents REST backend, which calls mcp-server tools — so there is no direct Web-to-mcp-server channel to build.

### 7. Agentic design: a diplomat front and a negotiator behind it

#### Two cooperating agents: diplomat + negotiator

- Each LLM player's diplomacy is handled by **two cooperating agents**, both extending the existing Envoy pattern rather than overloading the strategist's turn loop:
  - A **diplomat** — the human's only conversational counterpart, extending the existing `Diplomat` envoy. It exchanges free-text messages, owns the thread, and (as today) gathers intelligence from the conversation as it goes. Beyond its existing conversational tools (`get-briefing`, `get-diplomatic-events`, and the like), the diplomat gains **two new tools: propose-deal** (hand a deal off to the negotiator) and **close-conversation** (end the exchange). Closing is recorded as a **special message** in the transcript rather than a status flag, and it carries a game implication: once the diplomat closes, the conversation **cannot be reopened on the same turn** — the counterpart must wait until a later turn to talk again, giving an LLM diplomat a real way to walk away from a fruitless or hostile exchange.
  - A **negotiator** — a deal specialist equipped with the deal tools: inspect a proposed deal against the civ's strategy and persona, present a counter, accept, or reject, and drive enactment. To inspect, it fetches **per-term value and agreeability estimates** from the unified mcp-server **inspect-deal** tool (which now returns legality + estimates in one call, § Deal valuation visible to the negotiator) and weighs them against the civ's strategy. It is invoked *by the diplomat* as an agent-tool and **never handles human free-text directly.** The default runtime shape is a **diplomat⇔negotiator loop**: the diplomat relays the human's intent in, the negotiator returns its move out.

#### Per-seat agent selection

- **Each LLM seat chooses its diplomat and negotiator agents the same way it chooses its strategist today**, and those agents may have **different agentic setups** — different prompts, tools, even different models via the existing per-agent model-override map. This is the same per-seat selection model as strategists, and is expected to require a **refactor that generalizes per-seat agent assignment** beyond just the strategist (adding `diplomat` / `negotiator` fields to the seat config and resolving the *target* seat's configured agents from the conversation, instead of trusting a client-supplied agent name).

#### Authority lives in the agent

- **Authority is a property of the chosen negotiator agent, not a separate config knob.** How much latitude a negotiator has to accept, counter, or reject, and whether it consults anyone before committing, is baked into that agent's design — so a seat selects the behavior it wants simply by selecting the agent. There is no separate ratification-threshold setting.

### 8. Pacing and lifecycle

- **Human↔LLM conversations: the game is already paused.** A human is only interacting because their own decision point has paused the game (the existing human-control and pacing pause), so a human-driven conversation and any deal agreed in it happen against a stable game state by default — no new pause machinery is needed for the common case.
- **A conversation may stretch across turns.** Even a human conversation can outlive the pause that started it, and the game state it was reasoning about can move on. The **diplomat's design must account for this** — re-reading current game and diplomatic state as needed, and not assuming the world is frozen for the life of the thread. A deal is validated and enacted against the game state *at enactment time*, not at proposal time.
- **LLM↔LLM dialogues do not pause the game or the strategist by default.** Peer negotiations run alongside continued auto-play; they must not block the turn loop.
- A conversation ends explicitly, not as a side effect of a deal: rejecting or even accepting a proposal does not close it. The diplomat closes it via `close-conversation` (or the human closes it on the Web), which writes the closing special message from §7 — and that close locks the conversation for the rest of the current turn, so neither side can reopen it until a later turn. vox-agents derives open/closed status from the presence and turn of that message.

### 9. Surface and phasing

- **Web first.** The first version delivers the full conversation, deal negotiation, and real enactment flow on the Web, reusing the existing chat routes and Vue components and recreating the deal screen on the Web.
- **In-game later.** A subsequent phase adds an in-game diplomacy panel. Because the base-game / EUI trade screen is **not vendored in this repo**, the in-game panel is a **new mod UI addon** modeled on the existing human-control panel (`civ5-mod/.../VoxDeorumHumanPanel.lua`: a dormant addon that listens for a `LuaEvents` trigger and emits `Game.BroadcastEvent` on submit), reusing the game's trade screen where feasible.

## Component impact

### `mcp-server`

Durable transcript storage and the deal bridge:

- A single new **messages** table in the per-game knowledge store, keyed by the game and a pair of `playerID`s (no thread table or status column — one conversation per civ pair, §6).
- Tools to **append a message** (including the close-conversation special message) and **read the transcript** between two civs.
- A single read-only **inspect-deal** tool that constructs and queries a proposed deal in the game and returns, **per term in one call**: structural legality and reasons (for trade items), the **AI value estimate both directions** (for trade items, via the new `GetTradeItemValue` getter), and **agreeability factors** (for promises, assembled from existing diplomacy/opinion getters). Legality and estimation are unified here — there is no separate estimate tool.
- A non-read-only **enact-agent-deal** tool that calls the new DLL `EnactAgentDeal` function, passing both the trade items **and the promise commitment list**.
- Tools follow the existing `ToolBase` / `LuaFunctionTool` pattern and registry (`tools/index.ts`).

### `vox-agents`

The diplomat and negotiator agents and the per-seat config generalization:

- A **diplomat envoy** extended with **propose-deal** and **close-conversation** tools.
- A new deal-aware **negotiator envoy** invoked by the diplomat as an agent-tool (the diplomat⇔negotiator loop); both registered in the agent registry. Its deal artifact is **promise-aware** (trade items + promise commitments), and it has a tool to fetch per-term **value/agreeability estimates** via the unified mcp-server `inspect-deal` tool.
- `diplomat` / `negotiator` fields on `PlayerConfig`.
- Resolving the *target* seat's configured agents from a conversation (`getPlayerAssignments`) instead of trusting the client.
- Rewiring the web chat routes to persist transcripts through the mcp-server tools (the in-memory thread becomes a write-through cache).
- The diplomacy-config surface for which initiation directions are enabled.

### `civ5-dll`

The *only* gameplay code change:

- A new Lua-exposed entrypoint (an `EnactAgentDeal` method exposed in `CvLuaDeal.cpp`) that builds a `CvDeal`, validates it with the existing `AreAllTradeItemsValid()` for structural legality (classifying both sides as human, `bHumanToHuman = true`, so AI-only structural restrictions don't gate agent deals — §4), and activates it via the existing `FinalizeDealValidAndAccepted` / `ActivateDeal` with acceptance pre-decided — **without** invoking `CvDealAI`. The same entrypoint then **applies the deal's promise commitments** by calling the diplomacy setters directly — `SetXxxPromiseState` / `SetXxxPromiseTurn` (plus existing side-effects) for the eight standing promises, and `SetCoopWarState` for Coop War — all gated behind `MOD_ACTIVE_DIPLOMACY`.
- Inspection reuses `lIsPossibleToTradeItem` / `lGetReasonsItemUntradeable`, which already exist on the Lua-exposed `CvDeal` (`CvLuaDeal.cpp`) but are not yet wrapped by mcp-server, **plus a new read-only getter that wraps `CvDealAI::GetTradeItemValue`** per item, both directions, for the value estimates.
- **No `TradeableItems` enum change, no new save fields, and no new acceptability/valuation logic** (promise agreeability is factor-based reasoning in the agent, § Deal valuation visible to the negotiator). Requires a DLL rebuild and a version bump; the normal pathway is untouched.

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
- **Relaxing the always-on structural guards inside `IsPossibleToTradeItem`** (duplicate-luxury import, banned luxuries, capital, ownership, quantity, embassy-for-city, sapped/damaged cities, and similar). v1 honors these as structural and unchanged; relaxing a specific one would require threading an override flag through the function — a larger, riskier change deferred beyond v1. (The valuation-layer anti-exploit guards — last strategic-resource copy, last luxury while unhappy — are *not* in this category: they live in `CvDealAI` and are bypassed by design, per §4.)
- **Changing or branching the normal in-game deal or AI-valuation pathway.** The feature is purely additive.
- **The in-game diplomacy panel**, which is phased later — explicitly planned, not abandoned, but not delivered in v1.
- **New DLL acceptability or valuation logic for promises.** Promises are *enacted* through existing setters, but their "agreeability" is **factor-based reasoning by the negotiator agent**, not a new in-game verdict — keeping the DLL merge-compatible with upstream Vox Populi.
- **Representing promises as `TradeableItems`.** Promises are deal terms applied directly at enactment, not `CvTradedItem`s; the trade-item enum, its serialization, and the stock deal screen are untouched.

## Success criteria

- From the Web, a human seated as a civilization can open a conversation with an LLM-played civ, exchange messages, and the LLM responds in the voice of that seat's configured diplomat agent.
- Either side can present a structured deal mirroring the game's trade screen; the recipient can accept, counter, or reject; and a deal accepted by both sides is **enacted for real in the game** — items change hands — for deals the stock AI would have refused on political grounds, while structurally-illegal items are still rejected with a reason.
- A deal may include **any of the nine promises** (Coop War targeting a third party); an accepted promise is written to real diplomacy state and thereafter **behaves like an in-game promise** — honored and broken by the game's existing rules (e.g. broken by a later declaration of war).
- The negotiator sees **per-term value and agreeability estimates** for a deal under discussion; these inform its reasoning but **never gate enactment** on the agent path.
- The normal in-game deal pathway and AI valuation behave exactly as before; the agent path is a separate entrypoint, and no `TradeableItems` or save-format change is introduced.
- Conversation transcripts persist in the mcp-server and survive a restart; the Web reads them through vox-agents; deals are fetched live from the game rather than stored.
- Each LLM seat can be configured to use a different diplomat and negotiator agent (and model), and initiation can be enabled or disabled per direction — human↔LLM and, in later phases, LLM↔LLM.
