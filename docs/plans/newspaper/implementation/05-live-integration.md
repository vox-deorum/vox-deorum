# Plan 5: live publication in Civilization V

**Status: draft.** A human player gets a newspaper check every few completed turns, even without a Vox Deorum strategist. When a new issue publishes, a notification icon appears. The icon and a Newspaper entry in the top menu open the latest issue in the existing reader.

1. **Read the existing MCP database.** Use `get-newspaper-evidence`, which runs the same `queryNewspaperEvidence` as offline replay, with the human receiver, previous check, and a cutoff before the current turn. Reuse the replay editor and its comparison defaults. The available coverage comes from records MCP already writes. Missing observations follow the same rules as in replay.
2. **Run the check in the background.** Subscribe to MCP's `PlayerDoneTurn` notifications in Vox Agents independently of the strategist. Verify the cutoff in ordinary human play and use the existing default of five Standard speed turns, scaled by game speed. Run at most one check at a time. Keep the last checked turn, editorial state, and latest issue in memory for the current game and receiving seat. A skipped check advances the schedule and leaves the latest issue available. Clear state and discard pending results on load, game change, or seat change.
3. **Open the latest issue in game.** Add a small unread icon and a Newspaper entry via EUI's `AdditionalInformationDropdownGatherEntries`. Both send the same request for the latest issue. Reuse `game-delivery.ts` and the Lua reader, including its text fallback for missing cached textures. Clear the icon when that issue opens. Before the first issue, the menu can say that none has been published yet.

Verify in a short human game with no strategist: the scheduled check reads existing records, a published issue lights the icon, and both controls open it. A skipped check leaves the last issue available without a new alert. Reload while a check is running and verify that its old result cannot appear.

New evidence collection and reporting grants, archives and save restoration, live voting and settings, and a VD Newspaper page are outside this stage.
