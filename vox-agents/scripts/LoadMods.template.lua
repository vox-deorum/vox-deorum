local modActivating = -1
local modActivated = -1

print("LoadMods automation started!")

-- Access FrontEnd thread environment for direct API calls
local function getFrontEndEnv()
  local G = debug.getregistry()._LOADED._G
  for k, v in pairs(G.Threads) do
    if v.StateName == "FrontEnd" then
      return v
    end
  end
end

-- Activate required mods via direct Modding API access
local function activateMods()
  local env = getFrontEndEnv()
  if not env then
    print("ERROR: FrontEnd environment not found!")
    return
  end

  local Modding = env.Modding
  local requiredMods = {{REQUIRED_MODS}}

  for modId, modName in pairs(requiredMods) do
    local modVersion = Modding.GetLatestInstalledModVersion(modId)
    if modVersion and modVersion ~= -1 then
      Modding.EnableMod(modId, modVersion)
      print("Enabled: " .. modName .. " (" .. modId .. ", " .. modVersion .. ")")
    else
      print("WARNING: " .. modName .. " not found!")
    end
  end

  -- Civ5 persists the enabled-mods set across launches, so a mod enabled by a
  -- previous session stays on until explicitly disabled. Only force-disable the
  -- mods listed here (ours) -- the player's other modmods are left alone.
  local disabledMods = {{DISABLED_MODS}}
  for modId, modName in pairs(disabledMods) do
    local modVersion = Modding.GetLatestInstalledModVersion(modId)
    if modVersion and modVersion ~= -1 then
      Modding.DisableMod(modId, modVersion)
      print("Disabled: " .. modName .. " (" .. modId .. ", " .. modVersion .. ")")
    end
  end

  print("Activating enabled mods...")
  Modding.ActivateEnabledMods()
end

function onEndFrame()
  if modActivating > 0 and os.time() > modActivating + 2 then
    print("Trying to activate the mods...");
    activateMods();
    modActivating = 0;
    Automation.SetEventFunction("EndFrame", nil);
  end
end

Events.AfterModsActivate.Add(function()
  if (modActivating == -1) then
    print("Vanilla game activated!");
    modActivating = os.time();
    Automation.SetEventFunction("EndFrame", onEndFrame);
    return
  elseif (modActivated == -1) then
    print("Custom mods activated!");
    modActivated = os.time();
  end
end)
