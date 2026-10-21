import { gameDatabase } from "../../server.js";
import { DatabaseQueryTool } from "../abstract/database-query.js";
import * as z from "zod";
import { getEraName } from "../../utils/database/enums.js";

/**
 * Schema for project summary information
 */
const ProjectSummarySchema = z.object({
  Type: z.string(),
  Name: z.string(),
  Help: z.string(),
  Cost: z.number(),
  PrereqTech: z.string().nullable(),
  Era: z.string().nullable(),
  UniqueOf: z.string().nullable()
});

/**
 * Schema for full project information including relations
 */
const ProjectReportSchema = ProjectSummarySchema.extend({
  Strategy: z.string().nullable(),
  // The policy a player must adopt first, if any
  PrereqPolicy: z.string().nullable(),
  // How many policy branches a player must finish first, if any
  PolicyBranchesRequired: z.number().nullable(),
  // Projects that must be completed first, with a count when more than one is needed
  PrereqProjects: z.array(z.string()),
  // The victory this project counts toward, such as spaceship parts for a Science Victory
  Victory: z.string().nullable(),
  IsRepeatable: z.boolean(),
  // Instance limits; -1 means no limit
  MaxGlobalInstances: z.number(),
  MaxTeamInstances: z.number(),
  MaxPlayerInstances: z.number()
});

type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
type ProjectReport = z.infer<typeof ProjectReportSchema>;

/**
 * Tool for querying project information from the game database
 */
class GetProjectTool extends DatabaseQueryTool<ProjectSummary, ProjectReport> {
  /**
   * Unique identifier for the get project tool
   */
  readonly name = "get-project";

  /**
   * Human-readable description of the get project tool
   */
  readonly description = "Retrieves buildable project information (such as the Manhattan Project, the Apollo Program, and Citizen Earth Protocol) from the Civilization V game database with listing and fuzzy search capabilities";

  /**
   * Schema for project summary
   */
  protected readonly summarySchema = ProjectSummarySchema;

  /**
   * Schema for full project information
   */
  protected readonly fullSchema = ProjectReportSchema;

  /**
   * Full reports carry the in-game project tooltip
   */
  protected readonly tooltipKind = 'project';

  /**
   * Fetch project summaries from database
   */
  protected async fetchSummaries(): Promise<ProjectSummary[]> {
    const summaries = await gameDatabase.getDatabase()
      .selectFrom("Projects as p")
      .leftJoin("Technologies as t", "p.TechPrereq", "t.Type")
      .leftJoin("Civilizations as c", "c.Type", "p.CivilizationType")
      .leftJoin("Eras as e", "t.Era", "e.Type")
      .select([
        'p.Type',
        'p.Description as Name',
        'p.Help',
        'p.Cost',
        't.Description as PrereqTech',
        'c.ShortDescription as UniqueOf',
        'e.Type as Era'
      ])
      // A cost of -1 means no player can build the project, such as Vox Populi's spaceship parts, which are units
      .where('p.Cost', 'is not', -1)
      .execute() as ProjectSummary[];
    summaries.forEach(p => {
      p.Help = p.Help ?? '';
      p.Cost = p.Cost ?? 0;
      p.Era = projectEra(p.Era);
    });
    return summaries;
  }

  protected fetchFullInfo = getProject;
}

/**
 * Creates a new instance of the get project tool
 */
export default function createGetProjectTool() {
  return new GetProjectTool();
}

/**
 * Name the era of a project's prerequisite technology. Projects without one, such as Citizen
 * Earth Protocol, have no era rather than the ancient default other tools use.
 */
function projectEra(eraType: string | null | undefined): string | null {
  return eraType ? getEraName(eraType) ?? null : null;
}

/**
 * Fetch full project information for a specific project
 */
export async function getProject(projectType: string) {
  // Fetch base project info with technology name, era, unique civilization, victory, and policy
  const db = gameDatabase.getDatabase();
  const project = await db
    .selectFrom('Projects as p')
    .leftJoin('Technologies as t', 'p.TechPrereq', 't.Type')
    .leftJoin('Eras as e', 't.Era', 'e.Type')
    .leftJoin('Civilizations as c', 'c.Type', 'p.CivilizationType')
    .leftJoin('Victories as v', 'v.Type', 'p.VictoryPrereq')
    .leftJoin('Policies as pol', 'pol.Type', 'p.PolicyType')
    .selectAll('p')
    .select([
      't.Description as PrereqTechName',
      'pol.Description as PrereqPolicyName',
      'c.ShortDescription as UniqueCivName',
      'e.Type as EraType',
      'v.Description as VictoryName'
    ])
    .where('p.Type', '=', projectType)
    .executeTakeFirst();

  if (!project) {
    throw new Error(`Project ${projectType} not found`);
  }

  // Get prerequisite projects and how many of each are needed
  const prereqProjects = await db
    .selectFrom('Project_Prereqs as pp')
    .innerJoin('Projects as prereq', 'prereq.Type', 'pp.PrereqProjectType')
    .select(['prereq.Description', 'pp.AmountNeeded'])
    .where('pp.ProjectType', '=', projectType)
    .execute();

  // Construct the full project object
  return {
    Type: project.Type,
    Name: project.Description || '',
    Help: project.Help || '',
    Cost: project.Cost || 0,
    PrereqTech: project.PrereqTechName || null,
    Era: projectEra(project.EraType),
    UniqueOf: project.UniqueCivName || null,
    Strategy: project.Strategy,
    PrereqPolicy: project.PrereqPolicyName || null,
    PolicyBranchesRequired: project.CultureBranchesRequired || null,
    PrereqProjects: prereqProjects.map(p => {
      const name = p.Description || '';
      return (p.AmountNeeded ?? 1) > 1 ? `${name} x${p.AmountNeeded}` : name;
    }),
    Victory: project.VictoryName || null,
    IsRepeatable: Boolean(project.IsRepeatable),
    MaxGlobalInstances: project.MaxGlobalInstances ?? -1,
    MaxTeamInstances: project.MaxTeamInstances ?? -1,
    MaxPlayerInstances: project.MaxPlayerInstances ?? -1
  };
}
