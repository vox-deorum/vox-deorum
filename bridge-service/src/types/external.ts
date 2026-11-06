/**
 * Type definitions for external function operations
 */

import { APIResponse } from "./api.js";
import { IPCMessage } from "./event.js";

/**
 * Registered external function details
 */
export interface ExternalFunction extends ExternalFunctionMetadata {
  registeredAt: Date;
}

/**
 * Metadata for registering an external function
 */
export interface ExternalFunctionMetadata {
  name: string;
  url: string;
  async?: boolean;
  timeout?: number;
  description?: string;
}

/**
 * IPC message for external function registration
 */
export interface ExternalRegisterMessage extends IPCMessage {
  type: 'external_register';
  name: string;
  async: boolean;
}

/**
 * IPC message for external function unregistration
 */
export interface ExternalUnregisterMessage extends IPCMessage {
  type: 'external_unregister';
  name: string;
}

/**
 * External function call from Lua
 */
export interface ExternalCall {
  args: Record<string, unknown>;
  function: string;
}

/**
 * Response for a Lua external function call
 */
export type ExternalCallResponse<T = any> = APIResponse<T>;

/**
 * IPC message for external function call
 */
export interface ExternalCallMessage extends IPCMessage, ExternalCall {
  type: 'external_call';
  id: string;
  async: boolean;
}

/**
 * IPC message for external function response
 */
export interface ExternalResponseMessage<T = any> extends IPCMessage, ExternalCallResponse<T> {
  type: 'external_response';
  id: string;
}

/**
 * External function registration request
 */
export type ExternalFunctionRegistration = ExternalFunctionMetadata;

/**
 * External function call request (from external service perspective)
 */
export interface ExternalCallRequest {
  args: Record<string, unknown>;
  id: string;
}

/**
 * List of registered external functions
 */
export interface ExternalFunctionList {
  functions: ExternalFunction[];
}