-- Vox Deorum newspaper stage-scoped fixture driver.
--
-- The newspaper command writes VoxDeorumNewspaperFixture.lua beside this file.
-- That generated file is development-only and is not part of an ordinary mod
-- install, so a missing include is expected and must not stop the reader from
-- loading. The reader opens from LuaEvents.VoxDeorumNewspaperOpen, for example
-- from FireTuner, after this fixture is available.

pcall(include, "VoxDeorumNewspaperFixture")
