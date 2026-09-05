# Overview

The `ContractEnded` event is triggered when an active contract in Civilization V reaches its conclusion and is terminated. This event signals the end of a contractual agreement between players or entities, providing notification of contract completion for systems that track diplomatic relationships, economic agreements, or strategic alliances.

# Event Triggers

This event is triggered in the contract management system within `CvContractClasses.cpp`. The event fires when:

- An active contract reaches its natural expiration
- A contract is manually terminated by the system
- Contract duration has elapsed or completion conditions have been met
- The contract is being removed from the active contracts list
- Before the contract data is reset and returned to the inactive pool

The event occurs during the contract cleanup process, ensuring all systems are notified before the contract data is modified.

# Parameters

The event passes the following parameters in order:

1. **eHolder** (PlayerTypes) - The player ID who held/owned the contract
2. **eContract** (ContractTypes) - The type/ID of the contract that ended

# Event Details

The `ContractEnded` event provides information about:

- **Contract Identification**: Specific contract type that has concluded
- **Contract Owner**: Which player was responsible for or benefiting from the contract
- **Termination Context**: Notification that the contract has reached its end state
- **Cleanup Timing**: Event fires before contract data is reset, allowing systems to capture final contract state

This event is particularly useful for:

- Diplomatic relationship tracking and updates
- Economic impact analysis when contracts conclude
- Strategic AI planning based on contract lifecycles
- Historical record keeping of completed agreements
- Triggering follow-up actions or negotiations
- Resource allocation adjustments after contract expiration

The event serves as a clean notification mechanism that contract obligations have concluded and the agreement is no longer active.

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvContractClasses.cpp` at line 837

**Hook Mechanism**: Called via `GAMEEVENTINVOKE_HOOK()` macro with the event name "GAMEEVENT_ContractEnded"

**Invocation Context**: The event occurs within the contract termination process, specifically after the contract has been ended for the player and removed from the active contracts list, but before the contract data structure is reset and returned to the inactive contracts pool.

**Parameter Types**:

- `eHolder`: Represents the player who owned the contract (PlayerTypes enum)
- `eContract`: Represents the specific contract type (ContractTypes enum)

**Event Timing**: This is a termination event that fires at the exact moment when a contract transitions from active to inactive state, providing real-time notification of contract conclusion.

**System Integration**: Part of the broader contract management system that handles contract lifecycles, economic relationships, and diplomatic agreements between players.
