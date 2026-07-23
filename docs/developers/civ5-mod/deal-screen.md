# Deal screen

`UI/VoxDeorumDealScreen.lua` and `UI/VoxDeorumDealScreen.xml` wrap the VP EUI trade editor for authored, incoming, and own proposals. The wrapper owns proposal state, promise controls, validation feedback, and action dispatch. It does not enact deals or write transcript rows.

The Lua context ends by including `UI/VoxDeorumDealScreenMock.lua`. This final, stage-scoped include supplies the delayed mock driver and can be replaced by the live transport driver without changing the screen.

For FireTuner, `VoxDeorumDealMock.Open` opens one of six scenarios: `author`, `incoming`, `own`, `error`, `unavailable`, or `coop-war`. The error scenario returns a delayed failure and leaves the mounted editor available. The unavailable scenario intentionally includes ordinary and promise commitments that projection removes, leaving the legal remainder in its counter state. Coop War selects the first fully legal third major target. It does not open when no legal target exists, which is expected when the current game has no eligible third civilization.

The screen probes ordinary items against the live cumulative scratch deal. For each candidate, it checks the appropriate native availability, adds the item, then immediately calls `AreAllTradeItemsValid(true)`. An aggregate failure rejects that candidate and rebuilds the scratch deal from the already accepted items. Military, Expansion, and Border promises are selected only when their guarded live getter reports no active commitment. The mock otherwise falls back to structurally legal No Digging; unavailable is reserved for its deliberate degraded scenario.

Mock scenarios are presentation tools only. They do not create bridge traffic or native deal enactment.
