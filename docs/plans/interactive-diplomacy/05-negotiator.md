# Stage 5 — vox-agents: negotiator agent + diplomat deal tools + the loop

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Deals move through the **diplomat⇔negotiator loop** until both sides agree (specs §3, §7). An LLM civ's diplomacy uses **two cooperating agents**: a **diplomat** (the human's only conversational counterpart — free-text, owns the thread) and a **negotiator** (a deal specialist that never reads human free-text). The **negotiator is the sole decider of deal terms**; the **diplomat only relays context** and never authors terms.

A deal needs shaping when the human proposes one (the diplomat relays it with a briefing) or the diplomat decides it is time to negotiate (relaying intent, no terms). The loop hands the negotiator the tradable range + per-term estimates (`inspect-deal`, run upfront) along with that context; the negotiator then chooses **exactly one** of three terminal tools — accept-as-is / propose-or-counter / reject-as-is — and returns it to the diplomat, which voices it on the Web.

Real enactment still lands in stage 6, so the milestone here is **a deal both sides agree on**, reached through the loop and surfaced on the Web — not items changing hands.

## Work items

1. **`vox-agents/src/envoy/negotiator.ts`** (new) — a deal-aware envoy extending `LiveEnvoy`, invoked by the diplomat as an **agent-tool**, the **sole decider of deal terms**. It never reads the free-text thread and is grounded by **three contexts**:
   - **(1) game context + strategy/persona** — `get-briefing` / `get-diplomatic-events` plus the diplomat's briefing;
   - **(2) what is tradable and each item's value** — the `inspect-deal` results (tradable range + per-term legality + both-direction value/agreeability), **run upfront by the loop and placed in the negotiator's context** (it does not call `inspect-deal` itself);
   - **(3) what is on the table** — the active proposal the diplomat relays (absent when proposing outright).
   It carries a **promise-aware deal artifact** (trade items + promise commitments — specs §3) and chooses **exactly one** of three terminal tools, each returning an inward **`rationale`** (the negotiator's reasoning for the diplomat, never voiced verbatim):
   - **accept the deal as-is** — `rationale` only; enactment routes through `enact-agent-deal` (stage 6);
   - **propose / counter** — also writes a one-sentence outward **`message`** (schema-constrained to one sentence), storing both on the draft deal (`Payload.Deal.rationale` / `.message`); the draft becomes a `deal-proposal` or `deal-counter`;
   - **reject the deal as-is** — `rationale` only.
   Authority is **baked into the chosen negotiator agent** (specs §7), no separate ratification knob.
2. **`vox-agents/src/envoy/diplomat.ts`** — add two **relay** tools to the existing `Diplomat` (its `close-conversation` tool landed in stage 2). The diplomat **never authors deal terms** — it relays context in and voices the negotiator's move out:
   - **`forward-deal`** — relay a human-proposed/countered deal to the negotiator with a short briefing of the conversational context;
   - **`request-deal`** — relay strategic intent + briefing only, **no terms**; the negotiator constructs them.
   The diplomat **sees the deal at every step** — each deal move enters the diplomat's model context together with its `rationale` and `message` (alongside proposals, counters, and per-term estimates) — so it voices each move faithfully and keeps gathering intelligence.
3. **The diplomat⇔negotiator loop** — the diplomat relays context in (the on-the-table deal + briefing, or just intent + briefing); the loop runs `inspect-deal` upfront and injects the tradable range + per-term estimates into the negotiator's context; the negotiator returns **one of three moves** out; the diplomat voices it. Register both agents in `vox-agents/src/infra/agent-registry.ts` (the `initializeDefaults` idiom), resolving the **target seat's** configured `negotiator` from the seat config (the `negotiator` field added in stage 2). **Author the loop so it does not assume a blocking, human-paced exchange:** the human→LLM path naturally rides the existing pause (specs §8), but stage 8's LLM↔LLM peers must run alongside continued auto-play without blocking the turn loop. Keep the loop driver agnostic to whether either endpoint is human so stage 8 reuses it rather than forking it.
4. **Deal-state reducer over the transcript** — implement the server-side equivalent of the stage-4 UI reducer over append-ID order: proposal/counter messages create the active proposal, accept/reject messages reference the proposal they answer, `deal-enacted` records successful orchestration once stage 6 exists, and agreement exists only when the current proposal has the required acceptance from the recipient and no later counter/reject supersedes it. This reducer is used by Web/agent orchestration before calling stage-6 enactment; there is still no status column.
5. **Stored deal moves in the transcript** — proposal and counter messages carry the proposed terms in `Payload.Deal`, including the optional **`Payload.Deal.rationale`** and **`Payload.Deal.message`** (both optional — pinned in stage 3) and optional proposal-time `Payload.Value1` / `Payload.Value2` snapshots. Accept/reject/enacted messages carry no draft deal — just `Payload.ProposalMessageID`. Current legality and enactment checks still come from fresh `inspect-deal` / `enact-agent-deal` calls; `enact-agent-deal` is idempotent (it refuses a second enactment of a proposal ID that already has a `deal-enacted`).

## Reuse

`LiveEnvoy` / `Envoy` and the existing `Diplomat` (`src/envoy/*.ts`); the agent-as-tool invocation pattern already used for `call-diplomatic-analyst`; `createBriefingTool` and `get-diplomatic-events`; stage-3 `inspect-deal`; stage-2's deal-message flow and the Web deal screen (stage 4) as the human's proposal/counter surface.

## Verify

In a live session: (a) **diplomat-decided path** — the diplomat calls `request-deal` (intent + briefing, no terms); the loop runs `inspect-deal` and injects the tradable range + estimates; the negotiator values from that context, builds terms with a `rationale` + one-sentence `message` on the draft deal, and the diplomat voices it on the Web; the per-term estimates are visible to both agents in their reasoning/logs. (b) **human-forwarded path** — the human assembles a deal on the stage-4 screen (with an attached `message`); the diplomat `forward-deal`s it with a briefing; the negotiator counters with a draft deal carrying its `rationale` **and** one-sentence `message`; the diplomat relays the counter and its estimates; the human accepts and the transcript reducer reports an **agreed** deal. (Enactment is asserted in stage 6.)

## Done when

Both the diplomat-decided (`request-deal`) and human-forwarded (`forward-deal`) paths run the full loop end to end — the diplomat relays context in; the negotiator inspects, values, and chooses exactly one of accept / propose-or-counter / reject, attaching a `rationale` (and, on propose/counter, a one-sentence `message`) to the draft deal; the diplomat voices every move with its per-term estimates; and the append-only transcript reduces to an agreed current proposal — with real enactment the only thing still pending.
