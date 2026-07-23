# Diplomacy panel

`UI/VoxDeorumDiploPanel.lua` and `UI/VoxDeorumDiploPanel.xml` own the in-game conversation panel. The panel renders the transcript, conversation phase, and open proposal cards for the current counterpart.

The Lua context ends by including `UI/VoxDeorumDiploPanelMock.lua`. That stage-scoped mock driver is deliberately the final include, so the transport stage can replace the driver without changing the panel itself.

While the mock driver is active, six hidden development buttons become visible:

- Author
- Incoming
- Own Open
- Unavailable
- Coop War
- Error

Each button opens its named deal-screen mock scenario for the panel's current counterpart. The same scenarios can be opened directly through FireTuner. These controls are mock-only and do not form part of the live conversation UI.
