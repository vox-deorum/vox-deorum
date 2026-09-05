# Overview

The `ContractStarted` event is triggered when a new contract is initiated and becomes active in Civilization V. This event provides detailed information about the newly established contract, including its duration, cost, and the player who entered into the agreement. It serves as a notification mechanism for systems that need to track active contracts and their economic or strategic implications.

# Event Triggers

This event is triggered in the player contract management system within `CvContractClasses.cpp`. The event fires when:

- A player successfully initiates a new contract
- Contract terms have been established and validated
- The contract has been added to the active contracts list
- Contract units have been initialized (if applicable)
- All contract setup procedures have completed

The event occurs immediately after the contract becomes active, ensuring all systems are notified of the new contractual commitment.

# Parameters

The event passes the following parameters in order:

1. **m_pPlayer->GetID()** (PlayerTypes) - The player ID who started/owns the contract
2. **eContract** (ContractTypes) - The type/ID of the contract being started
3. **iTurns** (int) - Duration of the contract in game turns
4. **iMaintenance** (int) - Maintenance cost per turn for the contract

# Event Details

The `ContractStarted` event provides comprehensive information about:

- **Contract Owner**: Which player has entered into the contract agreement
- **Contract Type**: Specific type of contract being initiated
- **Contract Duration**: How long the contract will remain active
- **Economic Impact**: Per-turn maintenance cost of the contract
- **Timing**: Exact moment when the contract becomes active

This event is particularly useful for:

- Economic tracking systems monitoring player expenditures
- Diplomatic relationship systems tracking active agreements
- Strategic AI planning that considers contract commitments
- Resource allocation systems that account for ongoing maintenance costs
- Contract lifecycle management and monitoring
- Historical record keeping of player agreements
- Budget planning systems that track recurring expenses

The event provides all necessary information for systems to understand the full scope and implications of the newly started contract.

# Technical Details

**Source Location**: `CvGameCoreDLL_Expansion2/CvContractClasses.cpp` at line 387

**Hook Mechanism**: Called via `GAMEEVENTINVOKE_HOOK()` macro with the event name "GAMEEVENT_ContractStarted"

**Invocation Context**: The event occurs within the contract initiation process, specifically after the contract has been set as active, contract units have been initialized, and the contract has been added to the game's active contracts list.

**Parameter Details**:

- **Player ID**: Retrieved via `m_pPlayer->GetID()` representing the contract holder
- **Contract Type**: Direct enum value identifying the specific contract
- **Duration**: Integer value representing turn-based contract length
- **Maintenance**: Economic cost per turn for maintaining the contract

**Event Timing**: This is an initiation event that fires at the exact moment a contract transitions from potential to active state, providing immediate notification of the new contractual obligation.

**System Integration**: Part of the player contract management system that handles the lifecycle of individual player contracts and their economic impacts on gameplay.
