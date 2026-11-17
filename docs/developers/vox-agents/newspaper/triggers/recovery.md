# Recovery triggers

Recovery coverage reports a return from an earlier decline, shortage, or conflict. This page is for developers locating recovery entries and their compatibility notes. Read the [trigger overview](overview.md) for shared controls, units, and evidence rules.

The shipped `vox-agents/newspaper/triggers/recovery.json` and `vox-agents/newspaper/templates/recovery.json` are empty arrays. Recovery triggers live with the detectors that measure them.

| Coverage | Trigger or detector | Catalogue and page |
| --- | --- | --- |
| City population recovery | `city-recovery` | `triggers/cities.json`; [cities](cities.md#conditions-and-defaults) |
| Budget recovery | `budget-recovery` | `triggers/economy.json`; [economy](economy.md#conditions-and-defaults) |
| Peace after conflict | `peaceTransition` and `peace-enduring` entries | `triggers/peace.json`; [peace](peace.md#conditions-and-defaults) |

City recovery and budget recovery keep their category-specific conditions, defaults, placeholders, and repeat rules on those pages. Peace entries carry the `recovery` tag and are documented with settlements.

## Evidence and repeats

City recovery needs an observed decline followed by growth; budget recovery needs an observed deficit followed by persistent nonnegative income. Enduring peace needs a known settlement or an observed war-to-peace change. See the owning category pages for their evidence and repeat rules.

Placeholders belong to the detector. City recovery uses `recoveryGrowth`, `recoveryFromTurn`, and `recoveryToTurn`; budget recovery uses `income` and `stage`; peace uses the incident and duration placeholders in the [war and peace guide](war-and-peace.md#authored-placeholders).

## Saved runs and removed coverage

`city-recovery` retains its trigger ID and recovery placeholders.

Recovery's `settlement-recovery` template lives in `vox-agents/newspaper/templates/cities.json`. The old `city-contrast` trigger, `cityContrast` detector, `provincial-contrast` template, and `provincial-recovery` composite have been removed. New city angles should use the supported city detectors and their documented controls.

Saving and resuming follows the shared overlay and checkpoint rules in the [trigger overview](overview.md#existing-overlays-and-saved-runs).
