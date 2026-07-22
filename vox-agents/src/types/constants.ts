/**
 * @module types/constants
 *
 * UI constants and configuration for Vox Agents frontend.
 * Contains provider lists and form field definitions.
 */

import type { ToolMiddlewareType } from './config.js';

/**
 * API key field definition for UI forms
 */
export interface ApiKeyField {
  key: string;
  label: string;
  type: 'password' | 'text';
  placeholder?: string;
  helpLink?: string;
  helpTooltip?: string;
}

/**
 * Supported LLM providers for UI selection
 */
export const llmProviders = [
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Claude Code', value: 'claude-code' },
  { label: 'Codex (ChatGPT)', value: 'codex' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Google AI', value: 'google' },
  { label: 'AWS Bedrock', value: 'aws' },
  { label: 'OpenAI Compatible', value: 'openai-compatible' },
  { label: 'Chutes.ai', value: 'chutes' },
  { label: 'Synthetic.new', value: 'synthetic' }
];

/**
 * Tool middleware option definition for UI forms
 */
export interface ToolMiddlewareOption {
  label: string;
  value: ToolMiddlewareType;
  tooltip: string;
}

/**
 * Tool middleware options for model configuration
 */
export const toolMiddlewareOptions: ToolMiddlewareOption[] = [
  {
    label: 'Prompt-based Tool Calling',
    value: 'prompt',
    tooltip: 'Uses prompt engineering to enable tool calling for models without native support'
  },
  {
    label: 'Tool Rescue',
    value: 'rescue',
    tooltip: 'Automatically rescues failed tool calls and retries with improved prompts'
  },
  {
    label: 'Gemma3-style Tool Calling',
    value: 'gemma',
    tooltip: 'Specialized tool calling format optimized for Gemma 3 models'
  }
];

/**
 * Predefined role suggestions for user identity autocomplete in chat
 */
export const userRoleSuggestions = [
  'the leader',
  'a diplomat',
  'an advisor',
  'a military general',
  'a scholar',
  'a spy',
  'a merchant',
  'a religious leader',
  'a court historian',
  'an ambassador',
  'a foreign observer',
  'a citizen'
];

/**
 * API key field definitions for UI forms
 */
export const apiKeyFields: ApiKeyField[] = [
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI API Key',
    type: 'password',
    helpLink: 'https://info2951.infosci.cornell.edu/tutorials/openai-key.html',
    helpTooltip: 'Get your OpenAI API key from the OpenAI Platform'
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API Key',
    type: 'password',
    helpLink: 'https://platform.claude.com/docs/en/get-started',
    helpTooltip: 'Get your Anthropic API key from the Anthropic Console'
  },
  {
    key: 'GOOGLE_GENERATIVE_AI_API_KEY',
    label: 'Google Generative AI API Key',
    type: 'password',
    helpLink: 'https://ai.google.dev/gemini-api/docs/api-key',
    helpTooltip: 'Get your Google AI API key from Google AI Studio'
  },
  {
    key: 'CHUTES_API_KEY',
    label: 'Chutes API Key',
    type: 'password',
    helpLink: 'https://chutes.ai/',
    helpTooltip: 'Get your Chutes API key from the Chutes dashboard'
  },
  {
    key: 'SYNTHETIC_API_KEY',
    label: 'Synthetic API Key',
    type: 'password',
    helpLink: 'https://synthetic.new/',
    helpTooltip: 'Get your Synthetic API key from the Synthetic dashboard'
  },
  {
    key: 'OPENROUTER_API_KEY',
    label: 'OpenRouter API Key',
    type: 'password',
    helpLink: 'https://openrouter.ai/',
    helpTooltip: 'Get your OpenRouter API key from the OpenRouter dashboard'
  },
  {
    key: 'OPENAI_COMPATIBLE_URL',
    label: 'OpenAI Compatible URL (e.g. llama.cpp, ollama)',
    type: 'text',
    placeholder: 'http://127.0.0.1:11434',
    helpLink: 'https://lmstudio.ai/',
    helpTooltip: 'Enter the base URL of your OpenAI-compatible API endpoint'
  },
  {
    key: 'OPENAI_COMPATIBLE_API_KEY',
    label: 'OpenAI Compatible API Key',
    type: 'password',
    helpTooltip: 'Enter the API key if your OpenAI-compatible endpoint requires authentication'
  }
];
