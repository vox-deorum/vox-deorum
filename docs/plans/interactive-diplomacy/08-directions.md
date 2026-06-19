# Stage 8 — LLM→human and LLM→LLM directions (later phase — thin stub)

> Part of the interactive-diplomacy plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).
>
> **Status: later phase, not elaborated.** This stub records the intended shape. The machinery is already **direction-agnostic** (specs §5) — the conversation is keyed by a symmetric initiator/target player pair (stage 2) and any side can be human or LLM — so the remaining directions are mostly configuration + initiation surfaces, not a new system.

## Objective

Enable the two initiation directions beyond human→LLM, gated by configuration (specs §5):

- **LLM→human** — an LLM diplomat opens a conversation or sends a proposal to a human, who is notified.
- **LLM→LLM** — peer diplomats and negotiators bargain with each other.

## Work items (sketch)

- **Direction config surface** (`vox-agents/src/types/config.ts` + session config): per-seat/session flags to enable or disable initiating diplomacy, accepting incoming diplomacy, and each of the three directions — **none hard-wired on or off** (specs §5). Exact flag shape is an open item in [README.md](README.md).
- **LLM→human initiation** — a diplomat **tool** the LLM may choose to use (subject to config) that opens a conversation / sends a proposal toward a human seat and raises a notification; consistent with how agents already opt into actions via tools (specs §5). Surface incoming conversations and proposals on the Web (`vox-agents/ui` — an inbox/notification surface and the stage-4 deal screen for the incoming proposal).
- **LLM→LLM** — peer diplomat→negotiator bargaining that runs **alongside continued auto-play** and must **not block the turn loop or pause the game** (specs §8); reuses the same `call-negotiator` handoff (stage 5) and enactment (stage 6) with both endpoints LLM.
- Pacing/lifecycle per specs §8: human↔LLM rides the existing pause; LLM↔LLM does not pause; a conversation ends explicitly via `close-conversation`, not as a side effect of a deal.

## Verify

Each direction, gated by config: an LLM diplomat initiates toward a human (human is notified on the Web and can respond); two LLM civs negotiate a deal to agreement and enactment without pausing the game; disabling a direction in config prevents it.
