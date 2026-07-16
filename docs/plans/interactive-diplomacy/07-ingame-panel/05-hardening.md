# Stage 7.05: hardening, regression, parity review

> Part of the stage-7 sub-plan ([specs.md](specs.md); index [../07-ingame-panel.md](../07-ingame-panel.md)). The closing pass: degradation paths, size/edge sweeps, native-screen regression, and a comparability review against the Web flow: the human-control plan's `08-comparability-review.md` precedent.

## Objective

The panel fails soft everywhere, the watch-items are exercised rather than assumed, nothing native regressed, and the in-game experience is point-by-point comparable to the Web flow it mirrors.

## Work items

1. **Degradation paths (civ5-mod).** `pcall` guards around every push-event payload read (a malformed table renders an error row, never a Lua error: mirroring the HumanPanel's defensive style); the ~10 s transport-ack and ~90 s reply timeouts surface their Retry affordances; the `hasEnvoy:false` and services-down cases show the "envoy unavailable" body; the oversized-deal refusal shows its reason.
2. **Failure-mode sweep (whole stack).** Kill vox-agents mid-conversation (pending send times out into Retry; no `Lua.log` errors; recovery on restart + reopen); restart bridge-service (push functions still reachable, or the re-registration fallback engages); force an `overflowed()` push and a `ThreadBusyError` (both surface as error statuses, panel stays usable).
3. **Watch-item sweep (per specs).** Open a deal draft, add several ordinary terms and promises, then run server-side `inspect-deal`. Confirm the visible draft and submitted payload remain unchanged because `draftItems` and `draftPromises` rebuild the shared scratch deal. Test delimiter stripping in both directions. During a long reply, confirm deltas arrive at least one second apart while the action FIFO remains busy, and reopen the panel to confirm `Begin.busy` arrives before the turn finishes. Keep the push queue below the bridge's auto-pause threshold. Page through several hundred transcript rows without frame hitches; add lazy rendering only if profiling shows a problem.
4. **Regression pass.** Native trade screen, Discuss/Demand flows, and the notification panel behave stock (rename discipline, guarded click hook); the Web chat/deal routes behave exactly as before the stage-04 extraction (status codes included); human-control panel unaffected; `update_md5.py` re-run and mod deploys clean.
5. **Comparability review (doc).** After implementation, append a short comparison for each Web capability: history, greeting, streaming with revealable detail, deal cards and statuses, propose/counter/accept/reject/retract, close, and the stale-proposal guard. Record where the panel matches the Web, deliberately simplifies it (status-only streaming and no draft replay), or defers work. Feed the result into parent stages 8 and 9.

## Verify

Every listed sweep executed against a live game with results noted inline (this stage's work items are its verify); the comparability table filled in; no open `Lua.log` errors across the full pass.

## Done when

All degradation and watch-item behaviors are observed working, native and Web surfaces are regression-free, and the comparability review documents exactly how the in-game panel relates to the Web flow.
