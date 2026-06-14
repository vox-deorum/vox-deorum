# Stage 5 — vox-agents: negotiator agent + diplomat deal tools + the loop

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

Deals move through the **diplomat⇔negotiator loop** and both sides reach agreement (specs §3, §7). An LLM civ's diplomacy is handled by **two cooperating agents**: a **diplomat** (the human's only conversational counterpart, free-text, owns the thread) and a **negotiator** (a deal specialist that never reads human free-text). When a deal is put on the table — the human proposes one (forwarded by the diplomat with a briefing) or the diplomat itself decides to — the negotiator inspects, values, and shapes it via `inspect-deal`, then returns its move (accept / counter / reject) to the diplomat, which voices it on the Web.

Real enactment still lands in stage 6, so the milestone here is **a deal both sides agree on**, reached through the loop and surfaced on the Web — not items changing hands.

## Work items

1. **`vox-agents/src/envoy/negotiator.ts`** (new) — a deal-aware envoy extending `LiveEnvoy`, invoked by the diplomat as an **agent-tool**, that:
   - carries a **promise-aware deal artifact** (ordinary trade items + promise commitments — specs §3);
   - fetches **per-term value + agreeability estimates** via the stage-3 `inspect-deal` tool (one call yields legality + estimates);
   - carries `get-briefing` and `get-diplomatic-events` so it can read the same game/diplomatic state the diplomat sees (it never reads the free-text thread, so it is grounded by these + the diplomat's briefing);
   - decides to **inspect, counter, accept, or reject**; authority is **baked into the chosen negotiator agent** (specs §7), no separate ratification knob.
2. **`vox-agents/src/envoy/diplomat.ts`** — add two **deal** tools to the existing `Diplomat` (its `close-conversation` tool already landed in stage 2):
   - **`propose-deal`** — hand a deal the diplomat itself decided on to the negotiator;
   - **`forward-deal`** — when the human proposes/counters, pass that deal to the negotiator **with a short briefing** of the conversational context (the negotiator otherwise can't see the thread).
   The diplomat **sees the deal at every step** — the human's proposal, the negotiator's counters, and the per-term estimates — so it relays each move faithfully and keeps gathering intelligence.
3. **The diplomat⇔negotiator loop** — the diplomat relays the human's intent (with a briefing) in; the negotiator returns its move out; the diplomat voices it. Register both agents in `vox-agents/src/infra/agent-registry.ts` (the `initializeDefaults` idiom), resolving the **target seat's** configured `negotiator` from the seat config (the `negotiator` field added in stage 2). **Author the loop so it does not assume a blocking, human-paced exchange:** the human→LLM path naturally rides the existing pause (specs §8), but stage 8's LLM↔LLM peers must run alongside continued auto-play without blocking the turn loop. Keep the loop driver agnostic to whether either endpoint is human so stage 8 reuses it rather than forking it.
4. **Deal-state reducer over the transcript** — implement the server-side equivalent of the stage-4 UI reducer over append-ID order: proposal/counter messages create the active proposal, accept/reject messages reference the proposal they answer, `deal-enacted` records successful orchestration once stage 6 exists, and agreement exists only when the current proposal has the required acceptance from the recipient and no later counter/reject supersedes it. This reducer is used by Web/agent orchestration before calling stage-6 enactment; there is still no status column.
5. **Stored deal moves in the transcript** — proposal and counter messages carry the proposed terms in `Payload.Deal`, plus optional proposal-time `Payload.Value1` / `Payload.Value2` snapshots. Accept/reject/enacted messages carry `Payload.ProposalMessageID`. Current legality and enactment checks still come from fresh `inspect-deal` / stateless `enact-agent-deal` calls.

## Reuse

`LiveEnvoy` / `Envoy` and the existing `Diplomat` (`src/envoy/*.ts`); the agent-as-tool invocation pattern already used for `call-diplomatic-analyst`; `createBriefingTool` and `get-diplomatic-events`; stage-3 `inspect-deal`; stage-2's deal-message flow and the Web deal screen (stage 4) as the human's proposal/counter surface.

## Verify

In a live session: (a) **diplomat-decided path** — the diplomat calls `propose-deal`; the negotiator inspects/values via `inspect-deal`, returns a move, and the diplomat voices it on the Web; the per-term estimates are visible to both agents in their reasoning/logs. (b) **human-forwarded path** — the human assembles a deal on the stage-4 screen; the diplomat `forward-deal`s it with a briefing; the negotiator counters; the diplomat relays the counter and its estimates; the human accepts and the transcript reducer reports an **agreed** deal. (Enactment is asserted in stage 6.)

## Done when

Both the diplomat-decided and human-forwarded paths run the full loop end to end — the negotiator inspects, values, and counters/accepts via `inspect-deal`, the diplomat voices every move with its per-term estimates, and the append-only transcript can be reduced to an agreed current proposal — with real enactment the only thing still pending.
