/**
 * Tests for configuration loading, covering the numeric settings where 0 is a real
 * value rather than "unset". Port 0 asks the OS for any free port, so it has to
 * survive the environment/file/default fallback chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig } from '../../../src/utils/config.js';

describe('loadConfig', () => {
  describe('transport port', () => {
    const originalPort = process.env.MCP_PORT;
    const tempDirs: string[] = [];

    /**
     * Write a config.json into a throwaway directory and point process.cwd() at it,
     * so loadConfig reads that file instead of the repository's own config.json.
     */
    function useConfigFile(contents: unknown): void {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-mcp-config-'));
      tempDirs.push(dir);
      fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(contents), 'utf-8');
      vi.spyOn(process, 'cwd').mockReturnValue(dir);
    }

    beforeEach(() => {
      // The vitest config pins MCP_PORT for the real tier; start from an unset value.
      delete process.env.MCP_PORT;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (originalPort === undefined) {
        delete process.env.MCP_PORT;
      } else {
        process.env.MCP_PORT = originalPort;
      }
      tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
    });

    it('should keep a port of 0 requested through MCP_PORT', () => {
      useConfigFile({});
      process.env.MCP_PORT = '0';

      expect(loadConfig().transport.port).toBe(0);
    });

    it('should keep a port of 0 requested through config.json', () => {
      useConfigFile({ transport: { port: 0 } });

      expect(loadConfig().transport.port).toBe(0);
    });

    it('should let MCP_PORT override a port from config.json', () => {
      useConfigFile({ transport: { port: 4321 } });
      process.env.MCP_PORT = '0';

      expect(loadConfig().transport.port).toBe(0);
    });

    it('should fall back to the default port when nothing is configured', () => {
      useConfigFile({});

      expect(loadConfig().transport.port).toBe(4000);
    });

    it('should fall back to the default port when MCP_PORT is unparseable', () => {
      useConfigFile({});
      process.env.MCP_PORT = 'not-a-port';

      expect(loadConfig().transport.port).toBe(4000);
    });
  });
  describe('database language', () => {
    let directory: string;
    const originalLanguage = process.env.DB_LANGUAGE;

    beforeEach(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-language-config-'));
      vi.spyOn(process, 'cwd').mockReturnValue(directory);
      delete process.env.DB_LANGUAGE;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (originalLanguage === undefined) delete process.env.DB_LANGUAGE;
      else process.env.DB_LANGUAGE = originalLanguage;
      fs.rmSync(directory, { recursive: true, force: true });
    });

    it('follows the game automatically by default', () => {
      expect(loadConfig().database?.language).toBe('auto');
    });

    it('preserves an explicit file language and environment override', () => {
      fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ database: { language: 'ko_KR' } }));
      expect(loadConfig().database?.language).toBe('ko_KR');
      process.env.DB_LANGUAGE = 'zh_CN';
      expect(loadConfig().database?.language).toBe('zh_CN');
    });
  });

});
