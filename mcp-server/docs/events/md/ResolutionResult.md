# Overview

The ResolutionResult event is triggered when a World Congress or League resolution voting concludes, providing details about the resolution outcome. This event captures both enactment and repeal results for all types of World Congress proposals, including diplomatic victory votes, trade embargoes, city-state protection, and other international legislation.

# Event Triggers

This event is fired from `CvLeague::NotifyProposalResult()` when:

- World Congress/League voting session concludes
- Resolution results are being processed and notifications sent
- The game option `MOD_EVENTS_RESOLUTIONS` is enabled
- Called for both enact proposals and repeal proposals separately

The event fires during the `NotifySessionDone()` processing, which occurs after all voting is complete but before the proposal lists are cleared.

# Parameters

The event provides five parameters with mixed types (`"iiibb"` signature):

1. **Resolution Type** (`pProposal->GetType()`): The type identifier of the resolution being voted on
2. **Proposer Player ID** (`pProposal->GetProposalPlayer()`): The player who proposed the resolution
3. **Decision/Choice** (`iDecision` or `GetProposerDecision()->GetDecision()`): The specific choice or target of the resolution
4. **Is Enact** (boolean): `true` for enact proposals, `false` for repeal proposals
5. **Passed** (`pProposal->IsPassed()`): Boolean indicating whether the resolution passed or failed

# Event Details

The resolution system handles various types of World Congress legislation:

**Resolution Types Include:**

- Diplomatic Victory (World Leader election)
- Trade route embargoes and sanctions
- City-state protection and liberation
- World projects and competitions
- Luxury resource bans
- Ideology pressure resolutions
- Cultural and scientific cooperation agreements

**Voting Process:**

- Each resolution requires specific vote thresholds to pass
- Different resolutions may have different voting mechanics
- Some resolutions target specific players or city-states (captured in Decision parameter)
- Results affect global diplomacy and gameplay mechanics

**Dual Event System:**

- Enact proposals create new active resolutions when passed
- Repeal proposals remove existing active resolutions when passed
- Each type fires the event separately with appropriate parameters

The event provides comprehensive data for AI systems to understand global political shifts and adjust strategies accordingly.

# Technical Details

**Source Locations**:

- `CvVotingClasses.cpp` line 8701 (enact proposals)
- `CvVotingClasses.cpp` line 8742 (repeal proposals)  
  **Event Definition**: `GAMEEVENT_ResolutionResult` with signature `"iiibb"`  
  **Triggering Functions**: `NotifyProposalResult()` (overloaded for enact/repeal)  
  **Prerequisites**: `MOD_EVENTS_RESOLUTIONS` must be enabled

**Related Systems:**

- `NotifySessionDone()`: Orchestrates result processing
- Vote counting and threshold validation systems
- Player notification and UI update systems
- Global effects application and diplomatic consequence systems

This event fires alongside comprehensive player notifications and is essential for tracking the evolving international political landscape in late-game Civilization V scenarios.
