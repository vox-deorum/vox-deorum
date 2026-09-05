# Overview

The `GreatPersonExpended` event is triggered when a Great Person unit is consumed or expended to provide a benefit to the player. This event occurs when Great People use their special abilities, such as constructing improvements, creating Great Works, or providing immediate bonuses. The event enables tracking of Great Person usage for strategic analysis and AI decision-making.

# Event Triggers

This event is triggered in the following scenarios:

- When any Great Person unit uses its special ability and is consumed in the process
- During Great Person actions such as creating Great Works, constructing tile improvements, or providing instant benefits
- When Great People are expended for diplomatic influence with City-States
- After the Great Person provides instant yields and other benefits to the player

# Parameters

The event passes the following parameters:

**Legacy Path (Lua Hook):**

1. **Player ID** (`GetID()`) - The unique identifier of the player who owned the Great Person
2. **Great Person Unit Type** (`eGreatPersonUnit`) - The specific type identifier of the Great Person unit that was expended

**Modern Path (if MOD_EVENTS_GREAT_PEOPLE is enabled):**

1. **Player ID** (`GetID()`) - The unique identifier of the player who owned the Great Person
2. **Unit ID** (`pGreatPersonUnit->GetID()`) - The unique identifier of the specific Great Person unit
3. **Great Person Unit Type** (`eGreatPersonUnit`) - The specific type identifier of the Great Person unit that was expended
4. **X Coordinate** (`pGreatPersonUnit->getX()`) - The X map coordinate where the Great Person was expended
5. **Y Coordinate** (`pGreatPersonUnit->getY()`) - The Y map coordinate where the Great Person was expended

# Event Details

Great People represent significant figures in a civilization who can provide powerful one-time benefits when expended. This event captures the moment when these valuable units are consumed, which is crucial for:

- Strategic tracking of Great Person usage patterns
- AI analysis of optimal Great Person deployment timing
- Understanding the impact of Great Person expenditure on civilization development
- Monitoring the return on investment from Great Person generation

The event fires after the Great Person has provided its benefits, including:

- Instant yields based on the Great Person type
- Diplomatic influence changes with City-States
- Special abilities unique to each Great Person type
- Tile improvements or Great Works creation

This timing ensures that external systems can analyze both the action taken and its immediate results.

# Technical Details

**Source Files:**

- `CvGameCoreDLL_Expansion2/CvPlayer.cpp` (lines 27922, 27934)

**Triggering Functions:**

- `CvPlayer::DoGreatPersonExpended(UnitTypes eGreatPersonUnit, CvUnit* pGreatPersonUnit)` - Main function handling Great Person expenditure

**Event Implementation:** The event uses different mechanisms depending on mod configuration:

- **Modern Path:** Uses `GAMEEVENT_GreatPersonExpended` with extended parameters if `MOD_EVENTS_GREAT_PEOPLE` is enabled
- **Legacy Path:** Uses Lua script hook `GreatPersonExpended` with basic parameters for compatibility

**Modern Game Event Hook:**

```cpp
GAMEEVENTINVOKE_HOOK(GAMEEVENT_GreatPersonExpended, GetID(), pGreatPersonUnit->GetID(), eGreatPersonUnit, pGreatPersonUnit->getX(), pGreatPersonUnit->getY());
```

**Legacy Lua Hook:**

```cpp
LuaSupport::CallHook(pkScriptSystem, "GreatPersonExpended", args.get(), bResult);
```

**Related Systems:**

- `doInstantYield()` - Provides immediate benefits from Great Person expenditure
- `GetGreatPersonFromUnitClass()` - Determines the Great Person type from the unit class
- Minor Civilization influence system for diplomatic Great People
