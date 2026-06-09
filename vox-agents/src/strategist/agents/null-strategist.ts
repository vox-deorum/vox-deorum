/**
 * @module strategist/null-strategist
 *
 * Null strategist agent that forces VPAI to baseline defaults.
 * In Strategy mode: clears all economic/military strategies.
 * In Flavor mode: sets all flavors to 50 (balanced).
 * Grand strategy is not overridden in either mode, letting VPAI decide.
 * Additionally picks a random tech/policy when none is selected,
 * and resets all persona values to baseline (5) every turn.
 */

import { Strategist } from "../strategist.js";
import { VoxContext } from "../../infra/vox-context.js";
import { StrategistParameters, ensureGameState } from "../strategy-parameters.js";
import { getMetadata } from "../../utils/game/metadata.js";
import { seededIndex } from "../../utils/random.js";

/**
 * A strategist that forces VPAI back to neutral baseline defaults each turn.
 * Unlike NoneStrategist (which does nothing), this actively clears overrides
 * so the in-game AI runs on its own decision-making. Also picks random
 * tech/policy when none is queued and resets persona to midpoint baseline.
 */
export class NullStrategist extends Strategist {
  readonly name = "null-strategist";

  readonly displayName = "Vox Populi AI (Baseline)";

  readonly description = "Baseline agent that resets VPAI to defaults: empty strategies (Strategy mode) or balanced flavors (Flavor mode), with no grand strategy override";

  /**
   * Per-game cache of the resolved sync seed (or `null` when unseeded). The
   * sync seed is fixed for the life of a game, so it's read from MCP metadata
   * once per `gameID` rather than every turn. This singleton is shared across
   * all players/games; storing the in-flight promise dedupes the concurrent
   * first reads from the multiple players that share a game.
   */
  private readonly syncSeedCache = new Map<string, Promise<number | null>>();

  /**
   * Programmatically resets VPAI to baseline defaults, then returns empty
   * string to skip the LLM execution loop entirely.
   */
  public async getSystem(parameters: StrategistParameters, _input: unknown, context: VoxContext<StrategistParameters>): Promise<string> {
    const rationale = "Null agent baseline — letting VPAI decide on its own";
    const gameState = await ensureGameState(context, parameters);
    const syncSeed = await this.getSyncSeed(parameters);

    if (parameters.mode === "Flavor") {
      // Build balanced flavors from the game state's available flavor keys
      const flavorDescriptions = gameState.options?.Options?.Flavors as Record<string, string> | undefined;
      const balancedFlavors: Record<string, number> = {};
      if (flavorDescriptions) {
        for (const key of Object.keys(flavorDescriptions)) {
          balancedFlavors[key] = 50;
        }
      }

      await context.callTool("set-flavors", {
        PlayerID: parameters.playerID,
        Flavors: balancedFlavors,
        Rationale: rationale
      }, parameters);
    } else {
      await context.callTool("set-strategy", {
        PlayerID: parameters.playerID,
        EconomicStrategies: [],
        MilitaryStrategies: [],
        Rationale: rationale
      }, parameters);
    }

    // Pick a random technology if none is queued
    if (gameState.options?.Technology?.Next === "None") {
      const techs = gameState.options?.Options?.Technologies;
      if (techs && typeof techs === "object") {
        const techNames = Object.keys(techs as Record<string, unknown>);
        if (techNames.length > 0) {
          const randomTech = techNames[this.pickIndex(syncSeed, parameters, "tech", techNames.length)];
          await context.callTool("set-research", {
            PlayerID: parameters.playerID,
            Technology: randomTech,
            Rationale: rationale
          }, parameters);
        }
      }
    }

    // Pick a random policy if none is queued
    if (gameState.options?.Policy?.Next.startsWith("None")) {
      const policies = gameState.options?.Options?.Policies;
      if (policies && typeof policies === "object") {
        const policyDisplayNames = Object.keys(policies as Record<string, unknown>);
        if (policyDisplayNames.length > 0) {
          const randomDisplay = policyDisplayNames[this.pickIndex(syncSeed, parameters, "policy", policyDisplayNames.length)];
          // Extract base name before parenthetical suffix (set-policy strips it internally)
          const baseName = randomDisplay.includes(" (")
            ? randomDisplay.substring(0, randomDisplay.indexOf(" ("))
            : randomDisplay;
          await context.callTool("set-policy", {
            PlayerID: parameters.playerID,
            Policy: baseName,
            Rationale: rationale
          }, parameters);
        }
      }
    }

    // Reset all persona values to baseline (5 = midpoint of 1-10 scale)
    await context.callTool("set-persona", {
      PlayerID: parameters.playerID,
      VictoryCompetitiveness: 5, WonderCompetitiveness: 5, MinorCivCompetitiveness: 5,
      Boldness: 5, WarBias: 5, HostileBias: 5, WarmongerHate: 5,
      NeutralBias: 5, FriendlyBias: 5, GuardedBias: 5, AfraidBias: 5,
      DiplomaticBalance: 5, Friendliness: 5, WorkWithWillingness: 5,
      WorkAgainstWillingness: 5, Loyalty: 5, MinorCivFriendlyBias: 5,
      MinorCivNeutralBias: 5, MinorCivHostileBias: 5, MinorCivWarBias: 5,
      DenounceWillingness: 5, Forgiveness: 5, Meanness: 5, Neediness: 5,
      Chattiness: 5, DeceptiveBias: 5,
      Rationale: rationale
    }, parameters);

    return "";
  }

  /**
   * Resolve Civ's pregame sync seed for the current game, reading MCP metadata
   * at most once per `gameID` (the value is fixed for the life of a game).
   * Returns `null` when no usable fixed seed exists (missing/empty, or `"0"` —
   * Civ's sentinel for "choose a random seed" — or any non-positive/non-integer
   * value), in which case callers fall back to `Math.random` for
   * non-reproducible picks.
   *
   * When a seed was configured, the session's `verifyRandomSeeds` guarantees
   * this observed value equals it, so keying off it honors the pre-defined seed.
   */
  private getSyncSeed(parameters: StrategistParameters): Promise<number | null> {
    const gameID = parameters.gameID;
    let pending = this.syncSeedCache.get(gameID);
    if (!pending) {
      pending = getMetadata("syncRandSeed").then((text) => {
        const value = Number(text);
        return !text || !Number.isInteger(value) || value <= 0 ? null : value;
      });
      this.syncSeedCache.set(gameID, pending);
    }
    return pending;
  }

  /**
   * Pick an index into `[0, length)`. Seeded and reproducible when `syncSeed`
   * is present, otherwise non-deterministic. The seed key combines the sync
   * seed, player, turn, and a per-choice discriminator so different
   * players/turns/choices decorrelate while identical fixed-seed runs reproduce.
   * It deliberately excludes the gameID, which varies between runs of the same
   * fixed seed and would defeat reproducibility.
   */
  private pickIndex(syncSeed: number | null, parameters: StrategistParameters, choice: string, length: number): number {
    if (syncSeed === null) return Math.floor(Math.random() * length);
    return seededIndex(`${syncSeed}:${parameters.playerID ?? 0}:${parameters.turn}:${choice}`, length);
  }
}
