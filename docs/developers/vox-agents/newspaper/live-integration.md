# Newspaper live integration

**Status: Planned.** Live integration will collect evidence and schedule background newspapers for human civilizations independently of a strategist. A Newspaper page in the VD UI will show scheduling controls, status, and the active archive, with options to read in the browser or in game.

MCP's per-game SQLite database will hold issues, presentation choices, checks, and editorial state. The game reader submits votes and preferences to MCP. Each receiving civilization's save data adds only a checkpoint ID. Loading an older save selects its database revision; copying a save alone does not bring the archive. Offline replay keeps its separate database.

The in-game reader fetches issue text from MCP and displays it if the local render cache is missing or the renderer is unavailable. A disconnect leaves the open issue readable in memory. Reconnect to browse more issues or submit feedback.

See [Plan 5](../../../plans/newspaper/implementation/05-live-integration.md) for checkpoint restoration, collection boundaries, visibility policy, and transport.
