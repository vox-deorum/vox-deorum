# Overview

The UiDiploEvent is triggered when diplomatic events are initiated from the user interface and need to be processed by the game core. This event serves as a bridge between UI diplomatic actions and gameplay mechanics, allowing scripts to intercept and respond to diplomatic interactions initiated by players.

# Event Triggers

This event is fired from `CvGame::DoFromUIDiploEvent()` when:

- UI diplomatic actions are processed by the game core
- Players initiate diplomatic interactions through the interface
- The Lua script system is available and active
- The `MOD_EVENTS_DIPLO_EVENTS` option is disabled (otherwise a GameEvent fires instead)

The event fires before the diplomatic action is sent to the network layer via `sendFromUIDiploEvent()`.

# Parameters

The event provides four integer parameters:

1. **Event Type** (`eEvent`): The type of diplomatic event (FromUIDiploEventTypes enumeration)
2. **AI Player** (`eAIPlayer`): The player involved in the diplomatic interaction
3. **Argument 1** (`iArg1`): First argument specific to the diplomatic event type
4. **Argument 2** (`iArg2`): Second argument specific to the diplomatic event type

# Event Details

The diplomatic event system handles various UI-initiated diplomatic actions:

**Event Processing Flow:**

1. UI diplomatic action initiated by player
2. Event data passed to game core via `DoFromUIDiploEvent()`
3. Either GameEvent or Lua hook fires (depending on compilation options)
4. Event data transmitted to network layer for multiplayer synchronization

**Diplomatic Event Types:** The `FromUIDiploEventTypes` enumeration likely includes events such as:

- Diplomatic proposal initiations
- Trade offer submissions
- Declaration of war requests
- Peace treaty negotiations
- Alliance and pact formations
- City-state interactions

**Parameter Usage:** The `iArg1` and `iArg2` parameters provide event-specific data:

- Could represent resource amounts in trade deals
- Might specify city IDs or unit IDs involved
- May contain diplomatic modifier values
- Could include turn-based timing information

**Dual Event System:** When `MOD_EVENTS_DIPLO_EVENTS` is enabled, a GameEvent (`GAMEEVENT_UiDiploEvent`) fires instead of this Lua hook, providing the same functionality through the standard event system rather than Lua scripting.

# Technical Details

**Source Location**: `CvGame.cpp` line 5493  
**Hook Type**: Lua script hook (or GameEvent when `MOD_EVENTS_DIPLO_EVENTS` enabled)  
**Triggering Function**: `DoFromUIDiploEvent()`  
**Prerequisites**: Lua script system must be available, `MOD_EVENTS_DIPLO_EVENTS` disabled

**Alternative Event System:** When `MOD_EVENTS_DIPLO_EVENTS` is enabled, `GAMEEVENT_UiDiploEvent` fires instead with the same parameters.

**Network Integration:** After event processing, the diplomatic action is transmitted via:

- `gDLL->sendFromUIDiploEvent()`: Sends the diplomatic event to network layer
- This ensures multiplayer synchronization of diplomatic actions
- Maintains game state consistency across all players

**Script Integration:** This hook/event enables Lua scripts to implement custom diplomatic behaviors, such as:

- Validation of diplomatic actions before processing
- Custom diplomatic options and interactions
- Integration with mod-specific diplomatic systems
- Logging and tracking of diplomatic activities
- Implementation of alternative diplomatic mechanics

**UI-Gameplay Bridge:** This event represents the critical interface between player UI actions and core gameplay systems, ensuring that diplomatic interactions initiated through the interface are properly processed, validated, and synchronized in multiplayer environments.

The event provides comprehensive information for scripts that need to monitor, modify, or extend the diplomatic interaction system in Civilization V.
