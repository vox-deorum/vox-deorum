/**
 * Tool for setting a player's AI persona values in Civilization V
 */

import { ActionTool, sourceTurnField } from "../abstract/action.js";
import * as z from "zod";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { composeVisibility } from "../../knowledge/helpers/visibility.js";

const personaSchema = z.object({
  // Core Competitiveness & Ambition
  VictoryCompetitiveness: z.number().optional().describe("How aggressively the AI reacts to others pursuing victories (1-10)"),
  WonderCompetitiveness: z.number().optional().describe("How aggressively the AI reacts to others competing for wonders (1-10)"),
  MinorCivCompetitiveness: z.number().optional().describe("How aggressively the AI reacts to others competing for city-state influence (1-10)"),
  Boldness: z.number().optional().describe("Military risk-taking, territorial claim, and conquest desire (1-10)"),

  // War & Peace Tendencies
  WarBias: z.number().optional().describe("Likelihood to plan for or declare offensive war (1-10)"),
  HostileBias: z.number().optional().describe("Tendency toward hostile relationships without direct wars (1-10)"),
  WarmongerHate: z.number().optional().describe("How negatively AI reacts to warlike behaviors (1-10)"),
  NeutralBias: z.number().optional().describe("Tendency toward neutral relationships (1-10)"),
  FriendlyBias: z.number().optional().describe("Tendency toward friendly relationships (1-10)"),
  GuardedBias: z.number().optional().describe("Tendency to be guarded or cautiously defensive in diplomacy (1-10)"),
  AfraidBias: z.number().optional().describe("Tendency to be afraid of stronger civs (1-10)"),

  // Diplomacy & Cooperation
  DiplomaticBalance: z.number().optional().describe("Increases relationship with non-competitive civilizations and peaceful resolution of wars (1-10)"),
  Friendliness: z.number().optional().describe("Desire for friendship declarations and increases maximum DoFs (1-10)"),
  WorkWithWillingness: z.number().optional().describe("Tendency to support or collaborate with allies. Increase opinions to shared friends (1-10)"),
  WorkAgainstWillingness: z.number().optional().describe("Tendency to bond over shared enemies and jointly act against them (1-10)"),
  Loyalty: z.number().optional().describe("Loyalty to allies. Lower values allow for backstabbing (1-10)"),

  // Minor Civ Relations
  MinorCivFriendlyBias: z.number().optional().describe("Tendency to be friendly with city-states (1-10)"),
  MinorCivNeutralBias: z.number().optional().describe("Tendency to be neutral with city-states (1-10)"),
  MinorCivHostileBias: z.number().optional().describe("Tendency to be hostile with city-states (1-10)"),
  MinorCivWarBias: z.number().optional().describe("Likelihood to attack city-states (1-10)"),

  // Personality Traits
  DenounceWillingness: z.number().optional().describe("Readiness to denounce other civs (1-10)"),
  Forgiveness: z.number().optional().describe("How quickly to forgive past transgressions (1-10)"),
  Meanness: z.number().optional().describe("Aggressiveness in general. Demanding/bullying more while less likely to accept peace (1-10)"),
  Neediness: z.number().optional().describe("Desire for support from friends (1-10)"),
  Chattiness: z.number().optional().describe("How often they initiate diplomatic contact (1-10)"),
  DeceptiveBias: z.number().optional().describe("Tendency to be deceptively friendly (1-10)"),
});

/**
 * Tool that sets a player's AI persona values using a Lua function
 */
class SetPersonaTool extends ActionTool<Record<string, number>> {
  /**
   * Unique identifier for the set-persona tool
   */
  readonly name = "set-persona";

  /**
   * Human-readable description of the tool
   */
  readonly description = "Set a player's diplomatic personality (1-10). These values control the in-game AI's diplomatic patterns and decision-making. Only send in values you intend to change.";

  /**
   * Input schema for the set-persona tool
   */
  inputSchema = personaSchema.extend({
    PlayerID: z.number().min(0).max(MaxMajorCivs - 1).describe("ID of the player"),
    Rationale: z.string().describe("Briefly explain your rationale for adjusting these persona values")
  }).extend(sourceTurnField);

  /**
   * Result schema - returns previous persona values
   */
  protected resultSchema = z.record(z.string(), z.number());

  /**
   * The Lua function arguments
   */
  protected arguments = ["playerID", "personaValues"];
  
  /**
   * The Lua script to execute
   */
  protected script = `
    local activePlayer = Players[playerID]

    -- Capture previous persona values before setting new ones
    local previousPersona = activePlayer:GetPersona()

    -- Set new persona values (only non-nil values are updated)
    activePlayer:SetPersona(personaValues)

    -- Return the previous persona values
    return previousPersona
  `;

  /**
   * Execute the set-persona command
   */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    // Resolve turn and trim rationale
    const { Rationale: rawRationale, Turn: _sourceTurn, PlayerID, ...personaValues } = args;
    const Rationale = this.trimRationale(rawRationale);
    const turn = this.resolveSourceTurn(args);

    // Filter out undefined values and clamp to 1-10 range
    const filteredPersona = Object.fromEntries(
      Object.entries(personaValues)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => [key, Math.max(1, Math.min(10, value as number))])
    );

    // Call the parent execute with the persona values table
    const result = await super.call(PlayerID, filteredPersona);

    if (result.Success) {
      const store = this.getStore();
      const previousPersona = result.Result;
      const lastRationale = (await store.getMutableKnowledge("PersonaChanges", PlayerID))?.Rationale ?? "Unknown";

      // Every persona column is required, so skip history when the previous persona came back
      // empty (possibly as an array); the next turn-end read records the values instead.
      if (previousPersona && !Array.isArray(previousPersona) && Object.keys(previousPersona).length > 0) {
        // Store the previous persona with reason "In-Game AI"
        await store.storeMutableKnowledge(
          'PersonaChanges',
          PlayerID,
          {
            ...previousPersona,
            Rationale: lastRationale.startsWith("Tweaked by In-Game AI") ? lastRationale : `Tweaked by In-Game AI (${lastRationale.trim()})`
          },
          composeVisibility([PlayerID]),
          ["Rationale"], // Only ignore Rationale when checking for changes
          turn
        );

        // Store the new persona values in the database
        await store.storeMutableKnowledge(
          'PersonaChanges',
          PlayerID,
          {
            ...previousPersona, // Start with previous values
            ...filteredPersona, // Override with new values
            Rationale: Rationale
          },
          composeVisibility([PlayerID]),
          undefined,
          turn
        );
      }

      // Compare and send replay messages for actual changes
      const changeDescriptions: string[] = [];
      for (const field of Object.keys(filteredPersona)) {
        const beforeValue = previousPersona?.[field];
        const afterValue = filteredPersona[field as keyof typeof filteredPersona];
        if (beforeValue !== afterValue) {
          changeDescriptions.push(`${field}: ${beforeValue || "Default"} → ${afterValue}`);
        }
      }

      if (changeDescriptions.length > 0) {
        const summary = changeDescriptions.join("; ");
        await this.pushAction(PlayerID, "persona", summary, Rationale, "Diplomatic persona", turn);
      }
    }

    delete result.Result;
    return result;
  }
}

/**
 * Creates a new instance of the set persona tool
 */
export default function createSetPersonaTool() {
  return new SetPersonaTool();
}