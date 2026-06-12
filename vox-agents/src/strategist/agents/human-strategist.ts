/**
 * @module strategist/human-strategist
 *
 * Human-controlled strategist seat. A person occupies this seat and steers one
 * civilization through the same influence-level action space the LLM strategists
 * use (see docs/plans/human-control). Like {@link NullStrategist} it does all its
 * work inside `getSystem()` and returns `""`, which `VoxContext` treats as "no
 * model call" so the LLM loop is skipped entirely.
 *
 * The decision round-trip (stage 3): present the turn's options to the in-game
 * panel via `present-decision`, block on the per-session {@link HumanDecisionBus}
 * until the human submits, map that submission onto the regular MCP action tools
 * (Flavor mode), and record wall-clock deliberation time. The game stays paused
 * across the wait — `VoxPlayer.execute` paused it before running us — so an
 * unbounded `await` here simply holds that pause (spec §4, no timeout).
 *
 * The launcher keys off `strategist === "human-strategist"` to put the session
 * into human-control mode (animations on, observer UI off, view pinned to the
 * human's civ).
 */

import { Strategist } from "../strategist.js";
import { VoxContext } from "../../infra/vox-context.js";
import { StrategistParameters, ensureGameState } from "../strategy-parameters.js";
import { HumanDecisionSubmission } from "../human-decision-bus.js";

/**
 * Human strategist seat. Presents the decision, waits for the human's
 * submission, enacts it through the action tools, then returns "" to skip the
 * LLM execution loop, exactly like {@link NullStrategist}.
 */
export class HumanStrategist extends Strategist {
  readonly name = "human-strategist";

  readonly displayName = "Human Strategist";

  readonly description = "Human-controlled strategist seat, enabling you to play as if you are an LLM.";

  /**
   * Run one human decision turn: present, wait, enact, record. Returns "" so
   * `VoxContext.execute` skips the model call.
   */
  public async getSystem(parameters: StrategistParameters, _input: unknown, context: VoxContext<StrategistParameters>): Promise<string> {
    const playerID = parameters.playerID ?? 0;

    // Reset the per-turn deliberation slot up front so a crash mid-wait (the
    // bus request rejects) records 0 rather than the previous decision's value.
    parameters.workingMemory["deliberationMs"] = "0";

    // 1. Ensure the turn's game state is cached. VoxPlayer normally already
    //    refreshed it before running us; this primes the same snapshot the
    //    action tools below validate against (not used for presentation).
    await ensureGameState(context, parameters);

    // 2. Get the session's decision bus before notifying the panel. The wait is
    //    registered first so an immediate synthetic submission cannot race ahead
    //    of the pending request and get dropped as "nobody waiting".
    const bus = parameters._humanDecisionBus;
    if (!bus) {
      // No decision channel (misconfiguration): fall back to keeping the status
      // quo so the game still progresses rather than hanging forever.
      this.logger.error(`No human-decision bus for player ${playerID}; keeping the status quo.`);
      await context.callTool("keep-status-quo", {
        PlayerID: playerID,
        Mode: parameters.mode,
        Rationale: "No decision channel available — maintaining the current strategic direction."
      }, parameters);
      return "";
    }

    const requestedAt = Date.now();
    const submissionPromise = bus.request(playerID);
    this.logger.warn(`Presenting decision to the human for player ${playerID} on turn ${parameters.turn}; awaiting submission...`, {
      GameID: parameters.gameID,
      PlayerID: playerID
    });

    // 3. Hand the decision to the in-game panel. `present-decision` fetches the
    //    Flavor-mode OptionsReport itself, server-side, so we pass only the
    //    player and turn — no round-trip of the report across the MCP wire.
    //    Because the game is paused and get-options reads cached knowledge, the
    //    panel sees the same option landscape our action-tool mapping does.
    let submission: HumanDecisionSubmission;
    try {
      const presented = await context.callTool<boolean>("present-decision", {
        PlayerID: playerID,
        Turn: parameters.turn
      }, parameters);
      if (presented !== true) {
        const error = new Error(`Failed to present human decision for player ${playerID} on turn ${parameters.turn}`);
        bus.cancel(playerID, error);
        await submissionPromise.catch(() => undefined);
        throw error;
      }

      // Awaits unbounded (game is paused). Rejects on crash/abort cancellation,
      // which unwinds through VoxContext.execute (logged) and resumes the game.
      submission = await submissionPromise;
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      bus.cancel(playerID, reason);
      throw reason;
    }

    // 4. Wall-clock deliberation time (spec §4 — no foreground/active-time accounting).
    const deliberationMs = Date.now() - requestedAt;
    this.logger.warn(`Human decision received for player ${playerID} after ${deliberationMs}ms`, {
      GameID: parameters.gameID,
      PlayerID: playerID,
      StatusQuo: submission.StatusQuo === true
    });

    // 5. Map the submission onto the action tools (replicating the single rationale).
    await this.applyDecision(context, parameters, playerID, submission);

    // 6. Record deliberation time in both telemetry slots.
    await this.recordDeliberation(context, parameters, playerID, deliberationMs);

    // 7. Skip the LLM loop.
    return "";
  }

  /**
   * Enact the human's submission through the standard MCP action tools, in
   * Flavor mode, replicating the single free-text rationale across every call
   * (spec §2/§3). Each tool fires only when the panel actually submitted that
   * field.
   */
  private async applyDecision(
    context: VoxContext<StrategistParameters>,
    parameters: StrategistParameters,
    playerID: number,
    submission: HumanDecisionSubmission
  ): Promise<void> {
    const Rationale = (submission.Rationale ?? "").trim() || "Human strategist decision.";

    // Explicit keep-status-quo. Records a real decision with the human's actual
    // rationale — never the "[skipped]" sentinel, which tells keep-status-quo to
    // refresh AI settings *without* recording a decision (VoxPlayer's paced-skip
    // path). A human keep-status-quo IS a decision.
    if (submission.StatusQuo) {
      await context.callTool("keep-status-quo", {
        PlayerID: playerID,
        Mode: parameters.mode,
        Rationale
      }, parameters);
      return;
    }

    // Flavor-mode action space. The legacy Strategy mode (set-strategy) is not
    // supported for human decision-makers.

    // Grand strategy and/or flavors — one set-flavors call carries both.
    if (submission.GrandStrategy !== undefined || submission.Flavors !== undefined) {
      const flavorArgs: Record<string, unknown> = { PlayerID: playerID, Rationale };
      if (submission.GrandStrategy !== undefined) flavorArgs.GrandStrategy = submission.GrandStrategy;
      if (submission.Flavors !== undefined) flavorArgs.Flavors = submission.Flavors;
      await context.callTool("set-flavors", flavorArgs, parameters);
    }

    // Next research technology.
    if (submission.Technology !== undefined) {
      await context.callTool("set-research", {
        PlayerID: playerID,
        Technology: submission.Technology,
        Rationale
      }, parameters);
    }

    // Next policy (set-policy strips any parenthetical display suffix server-side).
    if (submission.Policy !== undefined) {
      await context.callTool("set-policy", {
        PlayerID: playerID,
        Policy: submission.Policy,
        Rationale
      }, parameters);
    }

    // Persona and relationships, like every category above, fire only when the
    // panel actually submitted them (spec §2 — the same action space LLM
    // strategists use).
    if (submission.Persona !== undefined) {
      await context.callTool("set-persona", {
        PlayerID: playerID,
        ...submission.Persona,
        Rationale
      }, parameters);
    }

    if (Array.isArray(submission.Relationships)) {
      for (const rel of submission.Relationships) {
        if (!rel || typeof rel.TargetID !== "number") continue;
        await context.callTool("set-relationship", {
          PlayerID: playerID,
          TargetID: rel.TargetID,
          Public: rel.Public ?? 0,
          Private: rel.Private ?? 0,
          Rationale
        }, parameters);
      }
    }
  }

  /**
   * Record wall-clock deliberation time in both telemetry slots, paralleling
   * how token usage is recorded:
   *
   * 1. Per-turn: stashed in `workingMemory` so `VoxPlayer` can write a
   *    `deliberation.ms` turn-span attribute (the turn span isn't the active
   *    span inside `getSystem` — `VoxContext.execute` wraps us in `agent.<name>`).
   * 2. Accumulated per-player total: written via `set-metadata`
   *    (`deliberationMs-<playerID>`), overwritten with the running total each
   *    decision — idempotent, mirroring the `inputTokens-<playerID>` totals.
   */
  private async recordDeliberation(
    context: VoxContext<StrategistParameters>,
    parameters: StrategistParameters,
    playerID: number,
    deliberationMs: number
  ): Promise<void> {
    parameters.workingMemory["deliberationMs"] = String(deliberationMs);

    const previousTotal = await this.readDeliberationTotal(context, parameters, playerID);
    const runningTotal = previousTotal + deliberationMs;
    parameters.workingMemory["deliberationMsTotal"] = String(runningTotal);

    await context.callTool("set-metadata", {
      Key: `deliberationMs-${playerID}`,
      Value: String(runningTotal)
    }, parameters);
  }

  /**
   * Return the running per-player deliberation total. Working memory is the
   * fast path within one VoxPlayer; metadata is the recovery path after a crash
   * recreates players and clears working memory.
   */
  private async readDeliberationTotal(
    context: VoxContext<StrategistParameters>,
    parameters: StrategistParameters,
    playerID: number
  ): Promise<number> {
    const memoryTotal = Number(parameters.workingMemory["deliberationMsTotal"]);
    if (Number.isFinite(memoryTotal)) return memoryTotal;

    const result = await context.callTool("get-metadata", {
      Key: `deliberationMs-${playerID}`
    }, parameters);
    const text = this.extractMetadataText(result);
    const metadataTotal = Number(text);
    return Number.isFinite(metadataTotal) ? metadataTotal : 0;
  }

  /** Extract a metadata value from the MCP wrapper's primitive-string result. */
  private extractMetadataText(result: unknown): string {
    if (typeof result === "string") return result;
    if (!result || typeof result !== "object") return "";

    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    if (Array.isArray(content)) {
      return content.find(item => item.type === "text" && typeof item.text === "string")?.text ?? "";
    }

    return "";
  }
}
