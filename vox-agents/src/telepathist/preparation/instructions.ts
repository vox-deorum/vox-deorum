/**
 * @module telepathist/preparation/instructions
 *
 * Zod schemas, types, instruction builders, and shared markdown parser
 * for turn and phase summarization. Each builder requests markdown output
 * with five top-level headings: Situation, SituationAbstract, Decisions, DecisionAbstract, Narrative.
 */

import { z } from 'zod';
import { renderSystemPrompt } from '../../utils/prompts/prompt-files.js';

/** Zod schema for turn summary structured output */
export const turnSummarySchema = z.object({
  situation: z.string().describe('Detailed world state paragraph covering military, economic, diplomatic, and research situation'),
  situationabstract: z.string().describe('Context-agnostic generalized summary of the situation with no concrete leader/city names'),
  decisions: z.string().describe('Detailed player decisions and reasoning for this turn'),
  decisionabstract: z.string().describe('Context-agnostic generalized summary of the decisions with no concrete leader/city names'),
  narrative: z.string().describe('Short combined narrative weaving situation and decisions together')
});

/** Zod schema for phase summary structured output */
export const phaseSummarySchema = z.object({
  situation: z.string().describe('Narrative paragraph of the phase\'s world state arc'),
  situationabstract: z.string().describe('Context-agnostic generalized phase summary of the situation with no concrete names'),
  decisions: z.string().describe('Narrative paragraph of the phase\'s strategic choices'),
  decisionabstract: z.string().describe('Context-agnostic generalized phase summary of the decisions with no concrete names'),
  narrative: z.string().describe('Short combined narrative for the phase')
});

/** Scope descriptor for summary instructions: either a single turn or a turn range (phase). */
type SummaryScope =
  | { type: 'turn'; turn: number }
  | { type: 'phase'; fromTurn: number; toTurn: number };

/**
 * Builds the instruction and reminder for turn or phase summarization.
 * Returns [instruction, reminder] — the reminder is placed after the data by the Summarizer.
 */
function buildSummaryInstruction(scope: SummaryScope): [string, string] {
  const isTurn = scope.type === 'turn';
  const label = isTurn ? 'turn' : 'phase';

  const preamble = isTurn
    ? `Accurately summarize the game state and decisions for turn ${scope.turn}.`
    : `Create a structured summary of this phase (turns ${scope.fromTurn}-${scope.toTurn}) based on the individual turn summaries provided. This summary will serve as high-level context for a conversation about the game.`;

  const situationDesc = isTurn
    ? `Detailed paragraphs summarizing, from an OBSERVER perspective, the world state: military situation, economic state, diplomatic state, research progress, and notable events.`
    : `An observation paragraph of the phase's world state arc: how the military, economic, diplomatic, and research landscape evolved across these turns.`;

  const decisionsDesc = isTurn
    ? `A detailed paragraph summarizing the leader's decisions and reasoning: what was the decisions before, what options were available, what was chosen, and explicitly stated rationale.`
    : `A narrative paragraph of the phase's strategic choices: the key decisions made, their rationale, and their outcomes.`;

  const focusBullets = isTurn
    ? `- Focus on what changed or is notable, e.g. any wars, peace treaties, or diplomatic shifts.
- Highlight strategic inflection points (new wars, pivotal technologies, policy adoptions).
- Carefully go through the raw game data to clarify uncertain situations.`
    : `- Identify the dominant themes and narrative arcs of this phase.
- Highlight major turning points: wars declared/ended, key technologies, policy adoptions, new cities.
- Note the overall trajectory: is the civilization expanding, at war, building infrastructure, etc.?`;

  const instruction = `${preamble}

# Guidelines
${renderSystemPrompt(undefined, 'shared/historian-guidelines')}

# Situation
${situationDesc}
 - NEVER discuss the leader's strategies, thoughts, diplomatic stances, ${isTurn ? 'AI flavors, ' : 'flavors, '}or decisions.
 - Include descriptions and comparisons with neighboring, enemy, or leading civilizations, whenever possible.
 - Include ideology allies and enemies, whenever possible.
 - ALWAYS describe other players' victory progresses, particularly if they edge close enough.

# SituationAbstract
A context-agnostic, one-paragraph ${label} summary of the Situation. Replace concrete names of cities, city-states with generic descriptions.
 - ALWAYS keep civilization names, e.g. "a maritime Civilization (Venice)".
 - NEVER discuss the leader's strategies, thoughts, diplomatic stances, flavors, or decisions.
 - The content should be digestable by future leaders (not too overwhelming, not too concise).

# Decisions
${decisionsDesc}
 - Report what is already in effect as well as what has been changed.

# DecisionAbstract
A context-agnostic, one-paragraph ${label} summary of the Decisions and leaders' rationale. Replace concrete names of cities, city-states with generic descriptions.
 - ALWAYS keep civilization names, e.g. "a maritime Civilization (Venice)".
 - ALWAYS keep concrete numbers, e.g. "increased military production (30 => 50)".
 - The content should be digestable by future leaders (not too overwhelming, not too concise).

# Narrative
A short combined narrative weaving the situation and decisions together into a cohesive ${label} summary.

# Focus
${focusBullets}

# Output Format
Respond in markdown with exactly these five top-level headings (generate them in this order, so earlier sections can provide context for later ones):
Situation, SituationAbstract, Decisions, DecisionAbstract, Narrative.`;

  const reminder = `- Respond ONLY with the five markdown sections following the EXACT guidelines: # Situation, # SituationAbstract, # Decisions, # DecisionAbstract, # Narrative.
- "Situation" must only cover world state: do NOT include any leader decisions or reasoning, including AI flavors.
- Do not include any other text or commentary outside those sections.`;

  return [instruction, reminder];
}

/** Builds turn summarization instruction. Delegates to the shared builder. */
export function buildTurnSummaryInstruction(turn: number): [string, string] {
  return buildSummaryInstruction({ type: 'turn', turn });
}

/** Builds phase summarization instruction. Delegates to the shared builder. */
export function buildPhaseSummaryInstruction(fromTurn: number, toTurn: number): [string, string] {
  return buildSummaryInstruction({ type: 'phase', fromTurn, toTurn });
}

/** The five expected summary heading names, in order. */
const summaryHeadings = ['situation', 'situationabstract', 'decisions', 'decisionabstract', 'narrative'] as const;

/**
 * Parses a markdown summary response into its five sections.
 * Splits on top-level `# ` headings and extracts content under
 * Situation, SituationAbstract, Decisions, DecisionAbstract, and Narrative (case-insensitive).
 * Validates the result against the provided Zod schema.
 */
export function parseSummaryMarkdown<T>(
  rawText: string,
  schema: z.ZodType<T>
): T | undefined {
  const sections: Record<string, string> = {};
  // Try # headings first, fall back to ## if no # found, then ### etc.
  // If no markdown headings found, fall back to **Bold** labels.
  let matches: RegExpMatchArray[] = [];
  for (let level = 1; level <= 4 && matches.length === 0; level++) {
    const hashes = '#'.repeat(level);
    const headingRegex = new RegExp(
      `^\\s*(?:\\*{1,2})?${hashes}(?!#)\\s+(.+?)(?:\\*{1,2})?\\s*$`,
      'gm'
    );
    matches = [...rawText.matchAll(headingRegex)];
  }
  if (matches.length === 0) {
    const boldRegex = /^\s*\*\*(.+?)\*\*\s*$/gm;
    matches = [...rawText.matchAll(boldRegex)];
  }

  for (let i = 0; i < matches.length; i++) {
    const headingName = matches[i][1].trim().toLowerCase();
    if (!(summaryHeadings as readonly string[]).includes(headingName)) continue;

    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : rawText.length;
    sections[headingName] = rawText.slice(start, end).trim()
      .replace(/^\s*---\s*$/gm, '').trim();
  }

  const result = schema.safeParse(sections);
  return result.success ? result.data : undefined;
}
