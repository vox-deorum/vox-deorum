/**
 * @module strategist/human-strategist
 *
 * Human-controlled strategist seat. A person occupies this seat and steers one
 * civilization through the same influence-level action space the LLM strategists
 * use (see docs/plans/human-control). This is the **stage 1 stub**: it follows
 * the {@link NullStrategist} idiom — does all its work inside `getSystem()` and
 * returns `""`, which `VoxContext` treats as "no model call" so the LLM loop is
 * skipped entirely.
 *
 * For now the stub simply keeps the status quo every decision turn (with a real
 * rationale, not the `"[skipped]"` sentinel) so the game plays through. The real
 * decision flow — present the turn's options to the in-game panel, block on the
 * human, map the submission onto action tools — is wired in stage 3.
 *
 * The launcher keys off `strategist === "human-strategist"` to put the session
 * into human-control mode (animations on, observer UI off, view pinned to the
 * human's civ), so registering this stub is enough to validate the launch shape
 * before any decision logic exists.
 */

import { Strategist } from "../strategist.js";
import { VoxContext } from "../../infra/vox-context.js";
import { StrategistParameters } from "../strategy-parameters.js";

/**
 * Human strategist seat (stage 1 stub).
 *
 * Keeps the current strategic direction each decision turn and returns an empty
 * system prompt to skip the LLM execution loop, exactly like {@link NullStrategist}.
 */
export class HumanStrategist extends Strategist {
  readonly name = "human-strategist";

  readonly displayName = "Human Strategist";

  readonly description = "Human-controlled strategist seat; stub keeps the status quo each decision turn (the in-game decision panel is wired in later stages)";

  /**
   * Records a keep-status-quo decision for the turn, then returns "" to skip the
   * LLM loop. Uses the player's configured decision mode and a real rationale so
   * the decision lands in the replay log and telemetry like any other (unlike the
   * paced-skip path, which passes the `"[skipped]"` sentinel).
   */
  public async getSystem(parameters: StrategistParameters, _input: unknown, context: VoxContext<StrategistParameters>): Promise<string> {
    await context.callTool("keep-status-quo", {
      PlayerID: parameters.playerID,
      Mode: parameters.mode,
      Rationale: "Human strategist (stub): maintaining the current strategic direction."
    }, parameters);

    return "";
  }
}
