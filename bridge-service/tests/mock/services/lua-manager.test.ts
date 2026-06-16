import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dllConnector } from '../../../src/services/dll-connector.js';
import { luaManager } from '../../../src/services/lua-manager.js';

describe('Lua Manager Registry Sync', () => {
  beforeEach(() => {
    luaManager.clearRegistry();
  });

  afterEach(() => {
    luaManager.clearRegistry();
  });

  it('adds registered functions from DLL events', () => {
    dllConnector.emit('lua_register', {
      type: 'lua_register',
      function: 'GetEmpireMood',
      description: 'Returns a mock empire mood'
    });

    expect(luaManager.getFunctions()).toEqual(['GetEmpireMood']);
  });

  it('removes unregistered functions from DLL events', () => {
    dllConnector.emit('lua_register', {
      type: 'lua_register',
      function: 'GetEmpireMood',
      description: 'Returns a mock empire mood'
    });
    dllConnector.emit('lua_unregister', {
      type: 'lua_unregister',
      function: 'GetEmpireMood'
    });

    expect(luaManager.getFunctions()).toEqual([]);
  });

  it('clears the registry when the DLL sends lua_clear', () => {
    dllConnector.emit('lua_register', {
      type: 'lua_register',
      function: 'GetEmpireMood',
      description: 'Returns a mock empire mood'
    });
    dllConnector.emit('lua_register', {
      type: 'lua_register',
      function: 'GetCityOutlook',
      description: 'Returns a mock city outlook'
    });

    dllConnector.emit('lua_clear');

    expect(luaManager.getFunctions()).toEqual([]);
  });
});
