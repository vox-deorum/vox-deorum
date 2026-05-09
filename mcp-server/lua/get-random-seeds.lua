-- Read Civ's authoritative pregame random seed values.
--
-- These are not the live RNG states. The live map/game RNGs can advance during
-- setup and gameplay; the pregame seeds are the stable values that reproduce a
-- start when written back to config.ini.
return Game.GetRandomSeeds()
