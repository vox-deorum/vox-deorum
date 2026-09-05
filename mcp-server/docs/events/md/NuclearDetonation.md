# Overview

The `NuclearDetonation` event is triggered when a nuclear weapon is detonated in the game. This event captures critical information about nuclear attacks, including the location, attacking player, and the diplomatic context of the strike.

# Event Triggers

This event is triggered in the following scenario:

- When a nuclear weapon (atomic bomb or nuclear missile) successfully detonates on a target location
- The event fires during combat resolution, specifically during the nuclear attack processing phase
- Captures both successful strikes and the diplomatic implications of nuclear warfare

# Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `attackerId` | `int` | The player ID of the civilization that launched the nuclear weapon |
| `x` | `int` | The X coordinate where the nuclear weapon detonated |
| `y` | `int` | The Y coordinate where the nuclear weapon detonated |
| `isWar` | `bool` | Whether the nuclear attack was against a civilization currently at war |
| `isBystander` | `bool` | Whether the nuclear strike affected neutral or non-combatant civilizations |

# Event Details

The `NuclearDetonation` event captures one of the most significant military actions in Civilization V. Nuclear weapons represent the pinnacle of military technology and their use has far-reaching consequences:

**Military Impact:**

- Massive damage to units and cities in the blast radius
- Potential to eliminate multiple units simultaneously
- Can damage or destroy city improvements and population
- Creates fallout that affects tile productivity

**Diplomatic Consequences:**

- Severe diplomatic penalties with all civilizations
- Potential to trigger widespread war declarations
- Long-lasting reputation damage affecting future diplomacy
- May affect World Congress votes and international relations

**Strategic Context:** The event parameters provide crucial context:

- **War Status**: Distinguishes between nuclear strikes during active warfare vs. surprise attacks
- **Bystander Impact**: Indicates whether neutral parties were affected, which has additional diplomatic penalties
- **Location Data**: Essential for assessing strategic targets and collateral damage

# Technical Details

**Source Location:** `CvGameCoreDLL_Expansion2/CvUnitCombat.cpp:2408`

**Trigger Context:** The event is invoked within the `CvUnitCombat` class during nuclear combat resolution, after damage calculations but during the combat processing phase.

**Event Hook:** Uses `LuaSupport::CallHook` to integrate with the Lua scripting system, allowing for custom nuclear warfare handling in mods.

**Combat Integration:** This event is part of the nuclear combat system and fires as part of the broader combat resolution mechanics.

**Code Reference:**

```cpp
args->Push(kAttacker.getOwner());
args->Push(plot.getX());
args->Push(plot.getY());
args->Push(bWar);
args->Push(bBystander);
LuaSupport::CallHook(pkScriptSystem, "NuclearDetonation", args.get(), bResult);
```

**Diplomatic Context Variables:**

- `bWar`: Determined by checking diplomatic state between attacker and target
- `bBystander`: Calculated based on whether neutral civilizations are affected by the blast

This event provides essential data for tracking nuclear weapons usage, which is critical for diplomatic systems, AI decision-making, victory condition tracking, and historical analysis of game progression. The combination of location, diplomatic context, and attacker information makes this one of the most strategically significant events in the game.
