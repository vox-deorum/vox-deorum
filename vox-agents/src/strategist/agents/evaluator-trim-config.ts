/**
 * @module strategist/agents/evaluator-trim-config
 *
 * The trim ladder for the evaluator strategist's state: what is cut or compressed, and in what
 * order, when the state is over budget. This file is data only, so it can be retuned without
 * touching the trimming code in `evaluator-trimming.ts`. Steps are cumulative and run top to
 * bottom; the walk stops at the first step after which the state fits. Steps are ordered by how
 * little each cut matters to the evaluator's decisions, least first. Anything no step names is
 * never trimmed (see docs/developers/vox-agents/evaluator-trimming.md).
 */

import type { EventTierName } from "../../utils/prompts/event-importance.js";

/** One step of the trim ladder: an id, a note for the model, and exactly one action. */
export type TrimStep = {
  /** Kebab-case id recorded in the `strategist.trim` span attribute. */
  id: string;
  /** A short phrase for the closing note that tells the model what was shortened. */
  note: string;
} & TrimAction;

/** The one thing a trim step does. */
export type TrimAction =
  /** Drop one event importance tier from # Events. */
  | { events: EventTierName }
  /** Delete these fields from every city in # Cities. */
  | { cityFields: readonly string[] }
  /** Delete these top-level sections from # Military. */
  | { militaryKeys: readonly string[] }
  /** Delete these fields from every tactical zone in # Military. */
  | { militaryZoneFields: readonly string[] }
  /** Remove city-states' relationship entries for other civilizations, keeping our own. */
  | { cityStateRelationships: true }
  /** Compress major civilizations' weighted opinion lists to their `keep` largest factors plus one merged line. */
  | { opinions: { keep: number } };

/** The evaluator strategist's trim settings. */
export const evaluatorTrimConfig: { budgetShare: number; ladder: readonly TrimStep[] } = {
  /**
   * Share of the model's input limit the state may use. The local token estimate counts about 14%
   * fewer tokens than Jev does, so the state needs this much headroom below the limit.
   */
  budgetShare: 0.9,

  ladder: [
    // Detail with no use without tools, or tactical detail the zone summaries already carry.
    { id: "events-noise", events: "noise", note: "minor tile and movement events left out" },
    { id: "city-ids", cityFields: ["ID"], note: "city IDs left out" },
    { id: "military-unit-stats", militaryKeys: ["Unit Stats"], note: "unit strength table left out" },
    {
      id: "military-zone-geometry",
      militaryZoneFields: ["Plots", "AreaID", "CenterX", "CenterY"],
      note: "tactical zone sizes and positions left out",
    },
    { id: "city-coordinates", cityFields: ["X", "Y"], note: "city coordinates left out" },
    // City detail the reports already sum up: growth shows in # Cities, and per-city yields add up
    // to the civilization totals in # Players.
    { id: "events-economy", events: "economy", note: "city economy events left out" },
    {
      id: "city-yields",
      cityFields: [
        "FoodStored", "FoodPerTurn", "ProductionStored", "ProductionPerTurn",
        "GoldPerTurn", "SciencePerTurn", "CulturePerTurn", "FaithPerTurn", "TourismPerTurn",
      ],
      note: "city yields left out",
    },
    // Battle outcomes already show in force changes and the military balance.
    { id: "events-combat", events: "combat", note: "battle and barbarian camp events left out" },
    // Compression keeps the factors that drive each relationship, so it goes before full cuts.
    { id: "opinions-top-3", opinions: { keep: 3 }, note: "opinions summarized to their 3 largest factors" },
    // Buildings are listed nowhere else.
    {
      id: "city-buildings",
      cityFields: ["ImportantBuildings", "BuildingCount", "GreatWorkCount"],
      note: "city buildings left out",
    },
    // What others are building hints at their intent, so it outlasts battle detail.
    { id: "events-units", events: "units", note: "routine unit training and creation events left out" },
    {
      id: "city-state-relationships",
      cityStateRelationships: true,
      note: "city-state relationships with other civilizations left out",
    },
    // The inputs closest to war, diplomacy, and victory decisions go last.
    { id: "events-force-changes", events: "force-changes", note: "unit upgrade, conversion, and loss events left out" },
    { id: "events-progress", events: "progress", note: "technology, policy, and building events left out" },
  ],
};
