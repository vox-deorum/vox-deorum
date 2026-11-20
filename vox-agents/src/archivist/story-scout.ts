import { renderSystemPrompt } from '../agents/prompts/prompt-files.js';
import { VoxAgent, type AgentParameters } from '../agents/runtime/vox-agent.js';
import type { VoxContext } from '../agents/runtime/vox-context.js';
import { storyScoutOutputSchema, type StoryScoutOutput } from './types.js';

export const storyScoutName = 'story-scout';

interface StoryScoutInput {
  civilization: string;
  material: string;
}

/** Collects newspaper pitches from one recorded turn in a single model response. */
export class StoryScout extends VoxAgent<AgentParameters, StoryScoutInput, StoryScoutOutput> {
  readonly name = storyScoutName;
  readonly description = 'Finds newspaper stories in recorded game state';
  public override maxSteps = 1;
  public override outputSchema = storyScoutOutputSchema;

  /** Render the editor's assignment for the civilization and sampled turn. */
  public async getSystem(params: AgentParameters, input: StoryScoutInput, context: VoxContext<AgentParameters>): Promise<string> {
    return renderSystemPrompt(context, this.name, { civilization: input.civilization, turn: params.turn });
  }

  /** Supply the recorded game state as the only user message. */
  public async getInitialMessages(_params: AgentParameters, input: StoryScoutInput) {
    return [{ role: 'user' as const, content: input.material }];
  }
}
