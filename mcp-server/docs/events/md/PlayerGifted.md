# Overview

The `PlayerGifted` event is triggered when a major civilization gives various types of gifts to a minor civilization (city-state). This event covers three different types of gifts: units, gold, and tile improvements.

# Event Triggers

This event is triggered in three distinct scenarios:

1. **Unit Gift**: When the `CvMinorCivAI::DoUnitGiftFromMajor` method processes a unit gift from a major civilization to a minor civilization
2. **Gold Gift**: When the `CvMinorCivAI::DoGoldGiftFromMajor` method processes a gold gift from a major civilization to a minor civilization
3. **Tile Improvement Gift**: When the `CvMinorCivAI::DoTileImprovementGiftFromMajor` method processes a tile improvement gift from a major civilization to a minor civilization

All triggers occur within minor civilization AI processing after the gift has been accepted and processed.

# Parameters

The event passes six parameters to event handlers, with different meanings depending on the gift type:

| Parameter | Type | Description |
| --- | --- | --- |
| GivingPlayer | int | The ID of the major civilization giving the gift |
| ReceivingPlayer | int | The ID of the minor civilization receiving the gift |
| GoldAmount | int | Amount of gold given (-1 for non-gold gifts) |
| UnitType | int | Type of unit given (-1 for non-unit gifts) |
| PlotX | int | X coordinate of tile improvement (-1 for non-tile gifts) |
| PlotY | int | Y coordinate of tile improvement (-1 for non-tile gifts) |

# Event Details

The event provides comprehensive information about different gift types:

**Unit Gifts:**

- `GivingPlayer`: Major civ giving the unit
- `ReceivingPlayer`: Minor civ receiving the unit
- `UnitType`: The specific unit type being gifted
- Other parameters: Set to -1

**Gold Gifts:**

- `GivingPlayer`: Major civ giving the gold
- `ReceivingPlayer`: Minor civ receiving the gold
- `GoldAmount`: The amount of gold being gifted
- Other parameters: Set to -1

**Tile Improvement Gifts:**

- `GivingPlayer`: Major civ paying for the improvement
- `ReceivingPlayer`: Minor civ receiving the improvement
- `PlotX` and `PlotY`: Coordinates of the plot where the improvement is built
- Other parameters: Set to -1

The event occurs after the gift has been processed and friendship changes have been applied.

# Technical Details

**Source File**: `F:\Minor Solutions\vox-deorum\civ5-dll\CvGameCoreDLL_Expansion2\CvMinorCivAI.cpp`

**Trigger Locations**:

- Line 17405: Unit gifts in `CvMinorCivAI::DoUnitGiftFromMajor`
- Line 17505: Gold gifts in `CvMinorCivAI::DoGoldGiftFromMajor`
- Line 17824: Tile improvement gifts in `CvMinorCivAI::DoTileImprovementGiftFromMajor`

**Event System**: Uses the game event hook system via `GAMEEVENTINVOKE_HOOK()`

**Conditional Compilation**: The event is only triggered when `MOD_EVENTS_MINORS_INTERACTION` is enabled

**Execution Context**: The event fires after gift processing is complete, specifically:

- After friendship/influence changes have been applied
- After quest completion checks have been performed
- After treasury changes have been made (for gold and tile improvement gifts)
- After unit transfers have been completed (for unit gifts)

**Gift Processing**: Each gift type triggers the event with the same signature but different parameter usage, allowing handlers to distinguish between gift types by checking which parameters are set to -1.
