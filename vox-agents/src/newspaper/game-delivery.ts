/** Register the mod reader and exchange structured requests through the shared MCP client. */
import { randomUUID } from 'node:crypto';
import { mcpClient } from '../agents/mcp/mcp-client.js';
import { unwrapMcpResponse } from '../agents/mcp/mcp-response.js';
import { asRecord } from '../utils/guards.js';
import { errorMessage } from '../utils/errors.js';
import type { buildLuaFixturePayload } from './export/lua-fixture.js';

export interface PreparedNewspaper { requestId: string; receiver: number }
export type NewspaperGamePayload = ReturnType<typeof buildLuaFixturePayload>;
type NewspaperClient = Pick<typeof mcpClient, 'connect' | 'callTool'>;
const connectionWaitMs = 8_000;

/** Explain either a transport error object or a reader's explicit rejection. */
function rejection(error: unknown, fallback: string): string {
  const details = asRecord(error);
  return typeof error === 'string' ? error
    : typeof details?.message === 'string' ? details.message
    : typeof details?.Message === 'string' ? details.Message : fallback;
}

/** Keep preparation before capture and acknowledge delivery only when the mod opened the reader. */
export class NewspaperGameDelivery {
  /** Reuse the process-wide connection and preserve established timeouts for game-bound calls. */
  constructor(private readonly client: NewspaperClient = mcpClient) {}

  /** Capture the game reader's current seat and request token before rendering begins. */
  async prepare(): Promise<PreparedNewspaper> {
    const requestId = randomUUID();
    await this.connect();
    const registered = unwrapMcpResponse(await this.client.callTool('lua-executor', {
      Script: 'LuaEvents.VoxDeorumNewspaperRegister(); return true',
      Description: 'Register the Vox Deorum newspaper reader',
    }, { retry: false }), 'Newspaper reader registration');
    if (registered.Success !== true || registered.Result !== true) {
      throw new Error(rejection(registered.Error, 'The Vox Deorum mod could not register its newspaper reader.'));
    }
    const result = await this.call('VoxDeorumNewspaperPrepare', [requestId]);
    if (result.requestId !== requestId || !Number.isInteger(result.receiver) || (result.receiver as number) < 0) {
      throw new Error('The newspaper reader did not return a valid active seat and request.');
    }
    return { requestId, receiver: result.receiver as number };
  }

  /** Send plain data as structured arguments and wait for an explicit opened-reader acknowledgement. */
  async deliver(prepared: PreparedNewspaper, payload: NewspaperGamePayload): Promise<void> {
    try {
      await this.call('VoxDeorumNewspaperDeliver', [prepared.requestId, payload]);
    } catch (error) {
      throw new Error(`The game did not confirm opening the newspaper. ${errorMessage(error)}`);
    }
  }

  /** Bound only this caller's initial connection wait without cancelling the shared connection. */
  private async connect(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.client.connect(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('The MCP service did not become ready in time.')), connectionWaitMs);
        }),
      ]);
    } catch (error) {
      throw new Error(`Cannot connect to the MCP service for newspaper delivery. Check that the Vox Deorum services are running and try again. ${errorMessage(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Check the MCP envelope, Lua transport response, and reader acknowledgement separately. */
  private async call(name: string, args: unknown[]): Promise<Record<string, unknown>> {
    const response = unwrapMcpResponse(await this.client.callTool('call-lua-function', {
      Name: name, Args: args,
    }, { retry: false }), name);
    if (response.success !== true) {
      throw new Error(`${rejection(response.error, `${name} failed.`)} Check that a Civilization V game is running with the Vox Deorum mod enabled.`);
    }
    const result = asRecord(response.result);
    if (result?.success !== true) throw new Error(rejection(result?.error, `${name} was rejected by the newspaper reader.`));
    return result;
  }
}
