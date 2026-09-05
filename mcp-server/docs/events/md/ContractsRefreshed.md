# Overview

The `ContractsRefreshed` event is triggered when the contract system completes a refresh cycle of all available contracts in Civilization V. This event signals that the contract pool has been updated, potentially adding new contracts, removing expired ones, or adjusting contract availability based on game state changes.

# Event Triggers

This event is triggered within the contract management system in `CvContractClasses.cpp`. The event fires when:

- The contract refresh cycle has completed processing
- All contract availability has been recalculated
- Contract pools have been updated based on current game conditions
- The system has finished evaluating which contracts should be available
- New contracts may have been added or existing ones modified

The event occurs at the conclusion of the contract refresh process, ensuring all contract state changes have been applied before notification.

# Parameters

This event takes no parameters. It serves as a simple notification that the contract refresh process has completed.

# Event Details

The `ContractsRefreshed` event provides notification about:

- **System State Update**: Confirmation that contract refresh cycle has completed
- **Availability Changes**: Implicit indication that contract availability may have changed
- **Timing Signal**: Notification for systems that need to respond to contract pool updates
- **Synchronization Point**: Marker for when contract-dependent systems should update their state

This event is particularly useful for:

- AI systems that need to evaluate newly available contracts
- Economic planning systems that track contract opportunities
- Diplomatic systems that respond to changing contract landscapes
- User interfaces that display available contracts
- Strategic planning systems that incorporate contract availability
- Logging and monitoring systems that track contract system activity

The event serves as a broadcast notification that interested systems should check for updated contract availability and adjust their strategies accordingly.

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvContractClasses.cpp` at line 714

**Hook Mechanism**: Called via `GAMEEVENTINVOKE_HOOK()` macro with the event name "GAMEEVENT_ContractsRefreshed"

**Invocation Context**: The event occurs at the end of the contract refresh process, after all internal contract pool updates and availability calculations have been completed.

**Parameter List**: No parameters are passed with this event, making it a simple notification event rather than a data-carrying event.

**Event Timing**: This is a system maintenance event that fires periodically when the game updates its contract availability, typically in response to turn progression, diplomatic changes, or other game state modifications.

**System Integration**: Part of the contract management infrastructure that maintains the pool of available contracts and ensures they remain current with game conditions and player relationships.
