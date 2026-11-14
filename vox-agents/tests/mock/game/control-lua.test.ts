/**
 * Tests for the engine-control Lua builders (src/game/control-lua.ts):
 * the autoplay-reconcile script that aligns a loaded/taken-over game's
 * serialized autoplay state with the session config, and the observer UI
 * override set-or-clear line.
 */

import { describe, it, expect } from 'vitest';
import {
  autoPlayTurnLimit,
  buildAutoPlayReconcileLua,
  buildNonFreshTransitionLua,
  buildObserverOverrideLua,
  buildStrategicViewLua,
} from '../../../src/game/control-lua.js';

describe('buildAutoPlayReconcileLua', () => {
  it('activates autoplay only when the game has it off', () => {
    const lua = buildAutoPlayReconcileLua(true, 0);
    expect(lua).toContain('if Game.GetAIAutoPlay() == 0 then');
    expect(lua).toContain(`Game.SetAIAutoPlay(${autoPlayTurnLimit}, -1);`);
    // No deactivation arms in the autoplay direction.
    expect(lua).not.toContain('Game.SetAIAutoPlay(0,');
  });

  it('cancels active autoplay and returns control to the human seat', () => {
    const lua = buildAutoPlayReconcileLua(false, 0);
    expect(lua).toContain('if Game.GetAIAutoPlay() > 0 then');
    expect(lua).toContain('Game.SetAIAutoPlay(0, 0);');
    // Expired-counter remedy: arm then disarm to take the deactivation path.
    expect(lua).toContain('elseif Game.GetActivePlayer() ~= 0 then');
    expect(lua).toContain('Game.SetAIAutoPlay(1, 0);');
    // Never re-activates in the interactive direction.
    expect(lua).not.toContain(String(autoPlayTurnLimit));
  });

  it('targets the given human seat in every arm', () => {
    const lua = buildAutoPlayReconcileLua(false, 3);
    expect(lua).toContain('Game.SetAIAutoPlay(0, 3);');
    expect(lua).toContain('elseif Game.GetActivePlayer() ~= 3 then');
    expect(lua).toContain('Game.SetAIAutoPlay(1, 3);');
    expect(lua).not.toContain('(0, 0)');
  });
});

describe('buildObserverOverrideLua', () => {
  it('clears the override when no human seat exists', () => {
    expect(buildObserverOverrideLua(undefined)).toBe('Game.SetObserverUIOverridePlayer(-1);\n');
  });

  it('pins the override to the human seat', () => {
    expect(buildObserverOverrideLua(4)).toBe('Game.SetObserverUIOverridePlayer(4);\n');
  });
});

describe('buildNonFreshTransitionLua', () => {
  it('keeps the observer override and autoplay return seat independent', () => {
    const lua = buildNonFreshTransitionLua(false, 3, 5);
    const override = lua.indexOf('Game.SetObserverUIOverridePlayer(3);');
    const loadClose = lua.indexOf('Events.LoadScreenClose();');
    const unpause = lua.indexOf('Game.SetPausePlayer(-1);');
    const reconcile = lua.indexOf('Game.GetAIAutoPlay()');
    expect(override).toBeGreaterThanOrEqual(0);
    expect(override).toBeLessThan(loadClose);
    expect(loadClose).toBeLessThan(unpause);
    expect(unpause).toBeLessThan(reconcile);
    expect(lua).toContain('Game.SetAIAutoPlay(0, 5);');
    expect(lua).not.toContain('Game.SetAIAutoPlay(0, 3);');
  });

  it('clears the override and reconciles toward autoplay with no human seat', () => {
    const lua = buildNonFreshTransitionLua(true, undefined, 0);
    expect(lua).toContain('Game.SetObserverUIOverridePlayer(-1);');
    expect(lua).toContain('if Game.GetAIAutoPlay() == 0 then');
  });
});

describe('buildStrategicViewLua', () => {
  it('allows a known fresh game to toggle when the query global is unavailable', () => {
    expect(buildStrategicViewLua(true)).toBe(
      'if InStrategicView == nil or not InStrategicView() then ToggleStrategicView(); end'
    );
  });

  it('fails closed for an adopted game when the query global is unavailable', () => {
    expect(buildStrategicViewLua(false)).toBe(
      'if InStrategicView ~= nil and not InStrategicView() then ToggleStrategicView(); end'
    );
  });
});
