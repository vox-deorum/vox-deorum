# Vox Agents Installation Guide

## Prerequisites

- Node.js v18+ and npm
- Running MCP Server (see `../mcp-server/README.md`)
- Running Bridge Service (see `../bridge-service/README.md`)
- At least one LLM API key

## Installation Steps

### 1. Install Dependencies

```bash
cd vox-agents
npm install
```

Note: You can also run `npm install` from the project root to install dependencies for all workspace modules.

### 2. Configure Environment

Copy the default environment template and configure your API keys:

```bash
cp .env.default .env
```

Edit `.env` and add at least one LLM provider API key:
- **OpenAI**: Get from https://platform.openai.com/api-keys
- **Anthropic**: Get from https://console.anthropic.com/account/keys
- **Google AI**: Get from https://aistudio.google.com/apikey
- **OpenRouter**: Get from https://openrouter.ai/keys

See `.env.default` for all available options with documentation.

### 3. Build the Project

```bash
npm run build
```

### 4. Configure Strategist (Optional)

Copy and customize a configuration file:

```bash
cp configs/observe-vanilla.json configs/custom.json
```

Edit `configs/custom.json` to set:
- `llmPlayers`: Which player IDs to control with AI
- `autoPlay`: Whether to auto-resume after decisions
- `strategist`: Which agent to use
- `gameMode`: "start" for new game, "load" for saved game

### 5. Verify Installation

Run tests to ensure everything is set up correctly:

```bash
npm test
```

## Running the Agent

### Development Mode (with hot reload)
```bash
npm run dev
```

### Production Mode
```bash
npm run strategist
# Or with custom config
npm run strategist -- --config=custom.json
```

### Telepathist Console (post-game analysis)
```bash
npm run telepathist
```

## Troubleshooting

### Missing API Keys
If you see errors about missing API keys:
1. Verify `.env` file exists (not `.env.default`)
2. Check that at least one API key is configured
3. Ensure no trailing spaces in API keys

### MCP Connection Failed
If the agent can't connect to MCP server:
1. Verify MCP server is running: `cd ../mcp-server && npm run dev`
2. Check the default port (3001) is not in use
3. Verify Bridge Service is also running

### Build Errors
If TypeScript compilation fails:
1. Ensure Node.js v18+ is installed: `node --version`
2. Clear node_modules and reinstall: `rm -rf node_modules && npm install`
3. Check for syntax errors in any custom configurations

## Next Steps

1. Read the [README](README.md) for usage details
2. Check [AGENTS.md](AGENTS.md) for development patterns
3. Review example configurations in `configs/`
4. Monitor agent behavior in the console