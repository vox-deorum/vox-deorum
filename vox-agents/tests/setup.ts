/**
 * Test setup file for Vox Agents
 * Configures the test environment and sets up global test utilities.
 */
import "../src/agents/config/load.js";

// Set default test environment variables if not already set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Set up test logging to reduce noise
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'error';
}
