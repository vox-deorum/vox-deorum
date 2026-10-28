# Reduce canal planning refreshes

**Status:** Implemented. DLL release builds and a controlled native-method comparison pass. Live coastal-save acceptance remains. See the [batch validation](1-2-6-8-results.md).

## Behavior

`CvBuilderTaskingAI::UpdateCanalPlots` now returns immediately when `MOD_GLOBAL_PASSABLE_FORTS` is disabled. Otherwise major civilizations refresh only when `(gameTurn + playerID) % 7 == 0`. Each player keeps its staggered phase, remembered canals retain their scoring preference between refreshes, and the existing clear-and-rebuild body uses unchanged water-path inputs.

`Uninit` clears `m_canalWantedPlots` so a previous game's plot indices cannot survive into another game. Loading still restores the serialized plan. The serialized field order, save format, canal score, and path rules are unchanged.

The cadence deliberately changes planning policy. New opportunities can wait up to six turns; a new game starts with an empty plan until its first phase turn. No structural-change tracking or first-turn refresh was added.

## Evidence and remaining checks

A C++03 fixture compiled the actual old and changed methods against controlled city/path inputs. With two owned cities over fourteen turns, refreshes fell from twelve to two and water floods from twenty-four to four. With passable forts disabled, floods fell from twenty-four to zero. Teardown now clears remembered canals. These are controlled work counts, with no measured whole-turn speedup.

The simulator omits builder planning. Release DLL compilation and the controlled fixture do not establish gameplay quality. Remaining checks are phase staggering on live saves, save/reload between refreshes, a second game in one process, and multi-turn coastal or archipelago comparisons of canal construction and builder-update time.

If the longer interval harms decisions, measure selected structural-change refreshes separately. Changing canal scoring, legality, trade algorithms, or the save format remains outside this item.
