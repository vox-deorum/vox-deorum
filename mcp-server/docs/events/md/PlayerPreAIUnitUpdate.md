# Overview

The PlayerPreAIUnitUpdate event is triggered just before the AI player performs unit updates during their turn. This event provides an opportunity for mods and external systems to intervene or analyze the game state before the AI makes decisions about unit movement, combat, and other unit-related actions.

# Event Triggers

This event is triggered when:

- An AI player is about to perform their unit update phase
- The script system is available and functional

The event fires before checking for busy units/cities and before any actual AI unit processing begins.

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `GetID()` | PlayerID | The unique identifier of the AI player about to perform unit updates |

# Event Details

The PlayerPreAIUnitUpdate event serves as a pre-processing hook for AI player unit updates. It is called through the Lua scripting system using the `CallHook` function, allowing Lua-based mods to intercept and potentially modify AI behavior before unit updates occur.

This event is particularly useful for:

- Analyzing AI player state before unit decisions
- Implementing custom AI logic or modifications
- Logging AI player activities for debugging purposes
- Applying temporary effects or conditions before AI processing

The event only passes the player ID, keeping the interface minimal while providing access to the player object through the game's API systems.

# Technical Details

**Source File**: `CvGameCoreDLL_Expansion2/CvPlayerAI.cpp` (Line 267)

**Execution Context**: The event is invoked:

- After script system availability check
- Before busy unit/city verification (fires regardless of busy unit/city status)
- Before any actual AI unit processing begins

**Script Integration**: This event uses the Lua scripting system through `LuaSupport::CallHook`, making it accessible to Lua-based modifications and allowing for script-based return values that could potentially influence subsequent processing.

**AI Flow Integration**: The event is part of the AI player's unit update cycle and serves as a gateway for external intervention in AI decision-making processes.
