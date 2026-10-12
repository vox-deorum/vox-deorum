import { gameDatabase } from "../../server.js";
import { DatabaseQueryTool } from "../abstract/database-query.js";
import * as z from "zod";
import * as changeCase from "change-case";
import { getEraName } from "../../utils/database/enums.js";

// =============================================================================
// Schemas & Types
// =============================================================================

/**
 * Schema for unit summary information
 */
const UnitSummarySchema = z.object({
  // Basic identification
  Type: z.string(),
  Name: z.string(),
  
  // Combat attributes
  Combat: z.number(),
  RangedCombat: z.number(),
  Moves: z.number(),
  
  // Production & tech
  Cost: z.number(),
  PrereqTech: z.string().nullable(),
  Era: z.string().nullable(),
  
  // Civilization uniqueness
  UniqueOf: z.string().nullable(),
  
  // Description
  Description: z.string().nullable(),

  // In-game tooltip, filled in for full reports
  Help: z.string().optional()
});

/**
 * Schema for full unit information including relations
 */
const UnitReportSchema = UnitSummarySchema.extend({
  // The standard unit a unique unit replaces
  Replaces: z.string().nullable(),
  AIType: z.string().nullable(),
  
  // Advanced combat attributes
  Range: z.number(),
  
  // Economic attributes
  Maintenance: z.number(),
  RequiredResources: z.record(z.string(), z.number()),
  
  // Technology progression
  ObsoleteTech: z.string().nullable(),
  UpgradedFrom: z.string().nullable(),
  UpgradesTo: z.string().nullable(),
  
  // Abilities & gameplay
  FreePromotions: z.array(z.string())
});

type UnitSummary = z.infer<typeof UnitSummarySchema>;
type UnitReport = z.infer<typeof UnitReportSchema>;

/** The civilization type whose unique units only barbarians field. */
const barbarianCivilization = "CIVILIZATION_BARBARIAN";

// =============================================================================
// Tool Implementation
// =============================================================================

/**
 * Tool for querying unit information from the game database
 */
class GetUnitTool extends DatabaseQueryTool<UnitSummary, UnitReport> {
  /**
   * Unique identifier for the get unit tool
   */
  readonly name = "get-unit";

  /**
   * Human-readable description of the get unit tool
   */
  readonly description = "Retrieves unit information from the Civilization V game database with listing and fuzzy search capabilities.";

  /**
   * Schema for unit summary
   */
  protected readonly summarySchema = UnitSummarySchema;

  /**
   * Schema for full unit information
   */
  protected readonly fullSchema = UnitReportSchema;

  /**
   * Full reports carry the in-game unit tooltip
   */
  protected readonly tooltipKind = 'unit';

  /**
   * Fetch unit summaries from database
   */
  protected async fetchSummaries(): Promise<UnitSummary[]> {
    const summaries = await gameDatabase.getDatabase()
      .selectFrom("Units as u")
      .leftJoin("Technologies as t", "u.PrereqTech", "t.Type")
      .leftJoin("Civilization_UnitClassOverrides as cuo", "cuo.UnitType", "u.Type")
      .leftJoin("Civilizations as c", "c.Type", "cuo.CivilizationType")
      .leftJoin("Eras as e", "t.Era", "e.Type")
      .select([
        'u.Type', 
        'u.Description as Name',
        'u.Strategy as Description',
        'u.Combat',
        'u.RangedCombat',
        'u.Moves',
        'u.Cost',
        't.Description as PrereqTech',
        'c.ShortDescription as UniqueOf',
        'e.Type as Era'
      ])
      .where('u.ShowInPedia', '=', 1)
      // Barbarian-only units can't be trained by any player
      .where(eb => eb.or([
        eb('cuo.CivilizationType', 'is', null),
        eb('cuo.CivilizationType', '!=', barbarianCivilization),
      ]))
      .execute() as UnitSummary[];
    summaries.forEach(p => {
      p.Era = p.Era ? getEraName(p.Era) ?? null : null;
    });
    return summaries;
  }
  
  protected fetchFullInfo = getUnit;
}

// =============================================================================
// Database Query Functions
// =============================================================================

/**
 * Fetch full unit information for a specific unit
 */
export async function getUnit(unitType: string) {
  const db = gameDatabase.getDatabase();
  
  // Fetch base unit info with technology names, unique civilization, and its class's standard unit
  const unit = await db
    .selectFrom('Units as u')
    .leftJoin('Technologies as prereqTech', 'u.PrereqTech', 'prereqTech.Type')
    .leftJoin('Technologies as obsoleteTech', 'u.ObsoleteTech', 'obsoleteTech.Type')
    .leftJoin('Civilization_UnitClassOverrides as cuo', 'cuo.UnitType', 'u.Type')
    .leftJoin('Civilizations as c', 'c.Type', 'cuo.CivilizationType')
    .leftJoin('UnitClasses as uc', 'u.Class', 'uc.Type')
    .leftJoin('Units as baseUnit', 'baseUnit.Type', 'uc.DefaultUnit')
    .selectAll('u')
    .select([
      'prereqTech.Description as PrereqTechName',
      'obsoleteTech.Description as ObsoleteTechName',
      'c.ShortDescription as UniqueCivName',
      'baseUnit.Type as DefaultUnitType',
      'baseUnit.Description as DefaultUnitName'
    ])
    .where('u.Type', '=', unitType)
    .executeTakeFirst();
  
  if (!unit) {
    throw new Error(`Unit ${unitType} not found`);
  }
  
  // Get the unit this upgrades from
  const upgradeFrom = await db
    .selectFrom('Unit_ClassUpgrades as ucu')
    .innerJoin('UnitClasses as fromClass', 'fromClass.Type', 'ucu.UnitClassType')
    .innerJoin('Units as fromUnit', 'fromUnit.Class', 'fromClass.Type')
    .select('fromUnit.Description')
    .where('ucu.UnitType', '=', unitType)
    .where('fromUnit.ShowInPedia', '=', 1)
    .executeTakeFirst();
  
  // Get the unit this can upgrade to
  const upgradeTo = await db
    .selectFrom('Unit_ClassUpgrades as ucu')
    .innerJoin('UnitClasses as uc', 'uc.Type', 'ucu.UnitClassType')
    .innerJoin('Units as toUnit', 'toUnit.Class', 'uc.Type')
    .innerJoin('Units as fromUnit', 'fromUnit.Type', 'ucu.UnitType')
    .select('toUnit.Description')
    .where('fromUnit.Type', '=', unitType)
    .where('toUnit.ShowInPedia', '=', 1)
    .executeTakeFirst();
  
  // Get required resources as dictionary
  const resourcesArray = await db
    .selectFrom('Unit_ResourceQuantityRequirements as urqr')
    .innerJoin('Resources as r', 'r.Type', 'urqr.ResourceType')
    .select(['r.Description as Resource', 'urqr.Cost as Amount'])
    .where('urqr.UnitType', '=', unitType)
    .execute();
  
  const resources: Record<string, number> = {};
  for (const res of resourcesArray) {
    if (res.Resource) {
      resources[res.Resource] = res.Amount || 0;
    }
  }
  
  // Get free promotions
  const promotions = await db
    .selectFrom('Unit_FreePromotions as ufp')
    .innerJoin('UnitPromotions as up', 'up.Type', 'ufp.PromotionType')
    .select('up.Description')
    .where('ufp.UnitType', '=', unitType)
    .execute();
  
  // Get Era from PrereqTech
  const era = unit.PrereqTech ? await db
    .selectFrom('Technologies as t')
    .leftJoin('Eras as e', 't.Era', 'e.Type')
    .select('e.Type as Era')
    .where('t.Type', '=', unit.PrereqTech)
    .executeTakeFirst() : null;
  
  // Construct the full unit object
  return {
    Type: unit.Type,
    Name: unit.Description || '',
    Description: unit.Strategy || null,
    Combat: unit.Combat || 0,
    RangedCombat: unit.RangedCombat || 0,
    Moves: unit.Moves || 0,
    Cost: unit.Cost || 0,
    PrereqTech: unit.PrereqTechName || null,
    UniqueOf: unit.UniqueCivName || null,
    Era: era?.Era ? getEraName(era.Era) ?? null : null,
    Replaces: unit.UniqueCivName && unit.DefaultUnitType !== unit.Type ? unit.DefaultUnitName || null : null,
    AIType: changeCase.pascalCase(unit.DefaultUnitAI?.substring(7) ?? ""),
    Range: unit.Range || 0,
    Maintenance: unit.ExtraMaintenanceCost || 0,
    ObsoleteTech: unit.ObsoleteTechName || null,
    UpgradedFrom: upgradeFrom?.Description || null,
    UpgradesTo: upgradeTo?.Description || null,
    RequiredResources: resources,
    FreePromotions: promotions.map((p) => p.Description || '')
  };
}

// =============================================================================
// Exports
// =============================================================================

/**
 * Creates a new instance of the get unit tool
 */
export default function createGetUnitTool() {
  return new GetUnitTool();
}