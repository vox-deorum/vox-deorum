# Newspaper live integration

**Status: Planned.** Live integration will collect evidence for human civilizations, schedule background publication checks, and persist issues and reader state with the game. It will add a dedicated Newspaper page to the VD UI, a shared browser reader, and an open-in-game action while keeping saved text readable when the service or renderer is unavailable.

The Newspaper page will show historical issues for the current campaign and receiver from the reconciled MCP mirror, along with scheduler status and errors. Its enable/disable control will change background scheduling independently of a strategist. The game reader will own votes and preferences. The page will reuse the existing VD server, reader, and export service.

The game save will own live publication history and feedback. Offline replay will remain a separate workflow. Scheduling and publication must respect completed-turn boundaries and discard work made stale by loading or switching games.

See [Plan 5: live publication, save persistence, and game reader](../../../plans/newspaper/implementation/05-live-integration.md). Save capacity, collection boundaries, visibility policy, and transport details remain open work in that plan.
