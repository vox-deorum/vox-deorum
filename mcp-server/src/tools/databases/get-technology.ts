import { gameDatabase } from "../../server.js";
import { DatabaseQueryTool } from "../abstract/database-query.js";
import * as z from "zod";
import { getEraName } from "../../utils/database/enums.js";

/**
 * Schema for technology summary information
 */
const TechnologySummarySchema = z.object({
  Type: z.string(),
  Name: z.string(),
  Help: z.string(),
  Cost: z.number(),
  Era: z.string().optional(),
  TechsUnlocked: z.array(z.string()).optional(),
});

/**
 * Schema for full technology information including relations
 */
const TechnologyReportSchema = TechnologySummarySchema.extend({
  TechsPrereq: z.array(z.string()),
  UnitsUnlocked: z.array(z.string()),
  BuildingsUnlocked: z.array(z.string()),
  ImprovementsUnlocked: z.array(z.string()),
  WorldWondersUnlocked: z.array(z.string()),
  NationalWondersUnlocked: z.array(z.string()),
  ResourcesRevealed: z.array(z.string())
});

type TechnologySummary = z.infer<typeof TechnologySummarySchema>;
type TechnologyReport = z.infer<typeof TechnologyReportSchema>;

/**
 * Tool for querying technology information from the game database
 */
class GetTechnologyTool extends DatabaseQueryTool<TechnologySummary, TechnologyReport> {
  /**
   * Unique identifier for the get technology tool
   */
  readonly name = "get-technology";

  /**
   * Human-readable description of the get technology tool
   */
  readonly description = "Retrieves technology information from the Civilization V game database with listing and fuzzy search capabilities";

  /**
   * Schema for technology summary
   */
  protected readonly summarySchema = TechnologySummarySchema;

  /**
   * Schema for full technology information
   */
  protected readonly fullSchema = TechnologyReportSchema;

  /**
   * Fetch technology summaries from database
   */
  protected async fetchSummaries(): Promise<TechnologySummary[]> {
    const db = gameDatabase.getDatabase();
    var summaries = await db
      .selectFrom("Technologies as t")
      .leftJoin("Eras as e", "t.Era", "e.Type")
      .select(['t.Type', 't.Description as Name', 't.Help', 't.Cost', 'e.Type as Era'])
      .execute() as TechnologySummary[];

    // Fetch TechsUnlocked for each technology
    for (const summary of summaries) {
      const techsUnlocked = await db
        .selectFrom('Technology_PrereqTechs')
        .innerJoin('Technologies as t', 't.Type', 'TechType')
        .select(['t.Description'])
        .where('PrereqTech', '=', summary.Type)
        .execute();

      summary.TechsUnlocked = techsUnlocked.map(t => t.Description!);
      summary.Era = getEraName(summary.Era);
    }

    return summaries;
  }
  
  protected fetchFullInfo = getTechnology;
}

/**
 * Creates a new instance of the get technology tool
 */
export default function createGetTechnologyTool() {
  return new GetTechnologyTool();
}

/**
 * Fetch full technology information for a specific technology
 */
export async function getTechnology(techType: string) {
  // Fetch base technology info with Era
  const db = gameDatabase.getDatabase();
  const tech = await db
    .selectFrom('Technologies as t')
    .leftJoin('Eras as e', 't.Era', 'e.Type')
    .selectAll('t')
    .select('e.Type as EraType')
    .where('t.Type', '=', techType)
    .executeTakeFirst();
  
  if (!tech) {
    throw new Error(`Technology ${techType} not found`);
  }
  
  // Get prerequisite technologies
  const prereqTechs = await db
    .selectFrom('Technology_PrereqTechs')
    .select('PrereqTech')
    .innerJoin('Technologies as t', 't.Type', 'PrereqTech')
    .select(['t.Description'])
    .where('TechType', '=', techType)
    .execute();
  
  // Get unlocked units
  const unitsUnlocked = await db
    .selectFrom('Units')
    .select('Description')
    .where('PrereqTech', '=', techType)
    .execute();
  
  // Get unlocked buildings
  const buildingsUnlocked = await db
    .selectFrom('Buildings')
    .innerJoin('BuildingClasses as c', 'c.Type', 'Buildings.BuildingClass')
    .where('PrereqTech', '=', techType)
    .select(['Buildings.Description', 'c.MaxGlobalInstances', 'c.MaxPlayerInstances'])
    .execute();
  
  // Get unlocked improvements
  const improvementsUnlocked = await db
    .selectFrom('Builds')
    .select('ImprovementType')
    .innerJoin('Improvements as i', 'i.Type', 'Builds.ImprovementType')
    .select(['i.Description'])
    .where('PrereqTech', '=', techType)
    .execute();
  
  // Get resources revealed by this technology
  const resourcesRevealed = await db
    .selectFrom('Resources')
    .select('Description')
    .where('TechReveal', '=', techType)
    .execute();

  // Get technologies unlocked by this technology
  const techsUnlocked = await db
    .selectFrom('Technology_PrereqTechs')
    .select('TechType')
    .innerJoin('Technologies as t', 't.Type', 'TechType')
    .select(['t.Description'])
    .where('PrereqTech', '=', techType)
    .execute();

  // Construct the full technology object
  return {
    Type: tech.Type,
    Name: tech.Description!,
    Help: tech.Help!,
    Cost: tech.Cost!,
    Era: getEraName(tech?.EraType),
    TechsPrereq: prereqTechs.map(p => p.Description!),
    TechsUnlocked: techsUnlocked.map(t => t.Description!),
    UnitsUnlocked: unitsUnlocked.map(u => u.Description!),
    BuildingsUnlocked: buildingsUnlocked.filter(b => b.MaxGlobalInstances == 0 && b.MaxPlayerInstances == 0).map(b => b.Description!),
    NationalWondersUnlocked: buildingsUnlocked.filter(b => b.MaxPlayerInstances == 1).map(b => b.Description!),
    WorldWondersUnlocked: buildingsUnlocked.filter(b => b.MaxGlobalInstances == 1).map(b => b.Description!),
    ImprovementsUnlocked: improvementsUnlocked.map(i => i.Description!),
    ResourcesRevealed: resourcesRevealed.map(r => r.Description!),
  };
}