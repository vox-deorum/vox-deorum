-- Vox Deorum conversation launcher wiring.
--
-- include()'d by our LeaderHeadRoot.lua override, so it runs INSIDE the
-- LeaderHeadRoot context and drives Controls.ConverseButton and its debug twin
-- Controls.ConverseMockButton (both declared in our LeaderHeadRoot.xml) directly
-- -- no cross-context lookups. The buttons sit in the native action stack
-- (VoxDeorumDiploStack) beside Discuss/Trade/War and are shown together when the
-- leader on screen is a met, living, major civilization.
-- Clicking it keeps the animated leader scene up; the conversation panel
-- overlays it as a higher-priority popup (the trade-screen pattern).

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

-- Toggle both launchers and reflow the native action stack around them. The two
-- buttons share one visibility rule: the sandbox opens the same conversation
-- surface, only against the offline mock drivers.
local function setConverseHidden(isHidden)
	Controls.ConverseButton:SetHide(isHidden)
	Controls.ConverseMockButton:SetHide(isHidden)
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

-- Open Vox Deorum over the still-live leader scene. Root-up is left true and
-- the button stays visible: the panel queues itself above this context, and
-- when it dequeues on Goodbye the root options (including Converse) return
-- via OnShowHide without a fresh AILeaderMessage. Seed the speech balloon the
-- same way OnTrade does so no stale line shows on return.
local function openConversation(useMockDrivers)
	if not canConverse(m_diploPlayerID) then return end
	-- Both contexts pick their driver from this one toggle, and each switch resets
	-- the panel and closes any mounted deal editor, so the plain Converse button is
	-- always the live conversation and one mock click enters the offline sandbox.
	LuaEvents.VoxDeorumUseMockDrivers(useMockDrivers)
	Controls.LeaderSpeech:SetText(Locale.ConvertTextKey("TXT_KEY_DIPLOMACY_ANYTHING_ELSE"))
	LuaEvents.VoxDeorumDiploOpen(m_diploPlayerID)
end

-- Open the live conversation.
local function onConverseClicked() openConversation(false) end

-- Open the offline mock sandbox.
local function onConverseMockClicked() openConversation(true) end

Controls.ConverseButton:ClearCallback(Mouse.eLClick)
Controls.ConverseButton:RegisterCallback(Mouse.eLClick, onConverseClicked)
Controls.ConverseMockButton:ClearCallback(Mouse.eLClick)
Controls.ConverseMockButton:RegisterCallback(Mouse.eLClick, onConverseMockClicked)
Events.AILeaderMessage.Add(onAILeaderMessage)
Events.LeavingLeaderViewMode.Add(onLeavingLeaderViewMode)
