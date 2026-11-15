-- Vox Deorum newspaper optional legacy fixture adapter for developer compatibility.
--
-- Developers may supply VoxDeorumNewspaperFixture.lua for manual UI checks.
-- This optional legacy file is absent from ordinary installs. FireTuner can call
-- LuaEvents.VoxDeorumNewspaperOpen to reopen the last successful live delivery,
-- or use the legacy fixture when no delivery has been displayed. Live delivery
-- passes structured data through the bridge callback without including files.

pcall(include, "VoxDeorumNewspaperFixture")
