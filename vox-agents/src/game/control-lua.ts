/**
 * @module game/control-lua
 *
 * Builders for the engine-control Lua snippets the strategist sends through
 * the MCP `lua-executor` tool: reconciling the save-serialized autoplay state
 * with the session config, pinning/clearing the observer UI override, and
 * entering strategic view. They return strings rather than issuing the calls
 * themselves because call sites compose them into single scripts where
 * statement ordering matters (e.g. the override must precede
 * `Events.LoadScreenClose()`).
 */

/** Number of turns used whenever Vox Deorum activates AI autoplay. */
export const autoPlayTurnLimit = 3000;

/**
 * Guarded Lua reconciling the engine's autoplay state with the session config.
 * Civ V serializes the autoplay counter, the return player, and the pregame
 * slot statuses into saves, so a loaded (or taken-over) game may still be
 * auto-playing when the config wants a human at the helm, or idle when the
 * config wants autoplay. Idempotent: every arm is a no-op when the game
 * already matches the config, so it is safe on every GameSwitched and on
 * crash recovery.
 *
 * - `autoPlay: true`, game idle (a loaded human save): activate autoplay.
 * - `autoPlay: false`, game auto-playing: `SetAIAutoPlay(0, seat)` takes the
 *   `CvGame::setAIAutoPlay` deactivation path, which reseats `returnPlayerID`
 *   as the live human.
 * - `autoPlay: false`, counter expired naturally (counter 0 but the active
 *   player is still parked in the observer slot): re-arm the counter — the
 *   activation path returns early when the active slot is already an observer
 *   — then disarm with a return player to take the full
 *   deactivation path and reseat the human.
 *
 * Caveat: if the return seat's civ is dead in the loaded save,
 * `CvGame::setAIAutoPlay` returns control as an observer instead.
 */
export function buildAutoPlayReconcileLua(autoPlay: boolean, returnPlayerID: number): string {
  if (autoPlay) {
    return `
if Game.GetAIAutoPlay() == 0 then
  Game.SetAIAutoPlay(${autoPlayTurnLimit}, -1);
end`;
  }
  return `
if Game.GetAIAutoPlay() > 0 then
  Game.SetAIAutoPlay(0, ${returnPlayerID});
elseif Game.GetActivePlayer() ~= ${returnPlayerID} then
  Game.SetAIAutoPlay(1, ${returnPlayerID});
  Game.SetAIAutoPlay(0, ${returnPlayerID});
end`;
}

/**
 * Set-or-clear line for the observer UI override. Clearing with -1 when no
 * human seat exists undoes a stale override serialized by a previous
 * human-control save. The DLL setter redoes the activation-time visibility
 * step whenever the override changes with autoplay already running — copying
 * the pinned civ's fog of war, or revealing all plots on a clear — so the
 * observer seat never keeps a stale civ's fog; when autoplay is off, a later
 * activation applies the same rule itself. `CvGame::setObserverUIOverridePlayer`
 * self-no-ops on unchanged values, so this is free on fresh games.
 */
export function buildObserverOverrideLua(humanID: number | undefined): string {
  return `Game.SetObserverUIOverridePlayer(${humanID ?? -1});\n`;
}

/**
 * The complete engine-control script for adopting a non-fresh game: a resumed
 * save, a live-game takeover, a non-autoplay start, or a crash-recovery
 * relaunch. One script because the statement ordering is the invariant:
 * the override must precede `Events.LoadScreenClose()` (the mod's screen-bar
 * gate re-evaluates on that event and bails when no override is set), and the
 * autoplay reconcile comes last so an activation it triggers seats the
 * observer with the final override state's visibility.
 */
export function buildNonFreshTransitionLua(
  autoPlay: boolean,
  observerOverridePlayerID: number | undefined,
  autoPlayReturnPlayerID: number,
): string {
  return `${buildObserverOverrideLua(observerOverridePlayerID)}Events.LoadScreenClose();
Game.SetPausePlayer(-1);${buildAutoPlayReconcileLua(autoPlay, autoPlayReturnPlayerID)}`;
}

/**
 * Build strategic-view entry Lua for either a known fresh game or an adopted
 * game whose current view is unknown. `ToggleStrategicView()` is a raw toggle,
 * so adopted and recovered games fail closed when `InStrategicView` is absent.
 * A fresh game can safely fall back to the toggle because it starts in normal
 * view.
 */
export function buildStrategicViewLua(isFreshGame: boolean): string {
  const condition = isFreshGame
    ? 'InStrategicView == nil or not InStrategicView()'
    : 'InStrategicView ~= nil and not InStrategicView()';
  return `if ${condition} then ToggleStrategicView(); end`;
}
