-- Vox Deorum conversation launcher wiring.
--
-- include()'d by our LeaderHeadRoot.lua override, so it runs INSIDE the
-- LeaderHeadRoot context and drives Controls.ConverseButton (declared in our
-- LeaderHeadRoot.xml) directly -- no cross-context lookups. The button sits in
-- the native action stack (VoxDeorumDiploStack) beside Discuss/Trade/War and is
-- shown when the leader on screen is a met, living, major civilization.

include("VoxDeorumSeat")

print("Vox Deorum: Converse launcher wired into LeaderHeadRoot")

local m_diploPlayerID = -1

-- Return whether the current leader is a met, living, major civilization.
local function canConverse(playerID)
	local activePlayerID = VoxDeorumSeat.EffectiveSeat()
	local activePlayer = Players[activePlayerID]
	local otherPlayer = Players[playerID]
	if activePlayer == nil or otherPlayer == nil or playerID == activePlayerID then return false end
	if not otherPlayer:IsAlive() or otherPlayer:IsMinorCiv() or otherPlayer:IsBarbarian() then return false end
	return Teams[activePlayer:GetTeam()]:IsHasMet(otherPlayer:GetTeam())
end

-- Toggle the launcher and reflow the native action stack around it.
local function setConverseHidden(isHidden)
	Controls.ConverseButton:SetHide(isHidden)
	Controls.VoxDeorumDiploStack:CalculateSize()
	Controls.VoxDeorumDiploStack:ReprocessAnchoring()
end

-- Track the leader currently shown by the native diplomacy scene.
local function onAILeaderMessage(diploPlayerID)
	m_diploPlayerID = diploPlayerID or -1
	local eligible = canConverse(m_diploPlayerID)
	print("Vox Deorum: Converse AILeaderMessage player=" .. tostring(m_diploPlayerID) .. " canConverse=" .. tostring(eligible))
	setConverseHidden(not eligible)
end

-- Hide the launcher when the native leader scene closes.
local function onLeavingLeaderViewMode()
	setConverseHidden(true)
end

-- Leave the native leader scene, then open Vox Deorum for the tracked leader.
local function onConverseClicked()
	if not canConverse(m_diploPlayerID) then return end
	setConverseHidden(true)
	UI.SetLeaderHeadRootUp(false)
	UI.RequestLeaveLeader()
	LuaEvents.VoxDeorumDiploOpen(m_diploPlayerID)
end

Controls.ConverseButton:ClearCallback(Mouse.eLClick)
Controls.ConverseButton:RegisterCallback(Mouse.eLClick, onConverseClicked)
Events.AILeaderMessage.Add(onAILeaderMessage)
Events.LeavingLeaderViewMode.Add(onLeavingLeaderViewMode)
