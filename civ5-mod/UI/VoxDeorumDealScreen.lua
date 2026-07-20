-- Vox Deorum wraps the Vox Populi trade screen with an independent, serializable draft.

include("VoxDeorumSeat")
include("InstanceManager")
include("VoxDeorumDealUtils")

local m_realUI = UI
local m_realGame = Game
local m_realDeal = UI.GetScratchDeal()
local m_actorID = -1
local m_counterpartID = -1
local m_mode = nil
local m_proposalMessageID = nil
local m_incomingMessage = ""
local m_outgoingMessage = ""
local m_baselineItems = {}
local m_baselinePromises = {}
local m_draftItems = {}
local m_draftPromises = {}
local m_expectedScratchFingerprint = nil
local m_nativeEditDirty = false
local m_rebuilding = false
local m_mounted = false
local m_pending = false
local m_settingMessage = false
local m_targetPromiserID = nil
local m_panelDemoted = false
local m_pendingDotSeconds = 0
local m_pendingDotCount = 0
local m_nativeBoundaryDepth = 0

local promiseMetadata = {
	MILITARY = { key = "TXT_KEY_VD_DEAL_PROMISE_MILITARY" },
	EXPANSION = { key = "TXT_KEY_VD_DEAL_PROMISE_EXPANSION" },
	BORDER = { key = "TXT_KEY_VD_DEAL_PROMISE_BORDER" },
	NO_DIGGING = { key = "TXT_KEY_VD_DEAL_PROMISE_NO_DIGGING" },
	COOP_WAR = { key = "TXT_KEY_VD_DEAL_PROMISE_COOP_WAR" },
}
local promiseOrder = { "MILITARY", "EXPANSION", "BORDER", "NO_DIGGING", "COOP_WAR" }
local deepCopy = VoxDeorumDealUtils.DeepCopy
local stableKey = VoxDeorumDealUtils.StableKey
local validateDealPayload = VoxDeorumDealUtils.ValidatePayload
local sanitizeMessage = VoxDeorumDealUtils.SanitizeMessage
local stripDelimiter = VoxDeorumDealUtils.StripDelimiter
local isInteger = VoxDeorumDealUtils.IsInteger
local itemFields = VoxDeorumDealUtils.ItemFields
local promiseFields = VoxDeorumDealUtils.PromiseFields

-- Read the current game's standard deal duration through the reusable helper.
local function defaultDealDuration() return VoxDeorumDealUtils.DefaultDealDuration(m_realGame) end

-- Read one item's fixed duration through the reusable helper.
local function durationForItem(itemType) return VoxDeorumDealUtils.DurationForItem(itemType, m_realGame) end

-- Read one promise's fixed duration through the reusable helper.
local function durationForPromise(promiseType) return VoxDeorumDealUtils.DurationForPromise(promiseType, m_realGame, GameDefines) end

-- Normalize one scratch-decoded item through the reusable helper.
local function normalizeItem(item) return VoxDeorumDealUtils.NormalizeItem(item, m_realGame) end

-- Normalize one wrapper-authored promise through the reusable helper.
local function normalizePromise(promise) return VoxDeorumDealUtils.NormalizePromise(promise, m_realGame, GameDefines) end

-- Normalize and symmetrize ordinary items through the reusable helper.
local function normalizeItems(items) return VoxDeorumDealUtils.NormalizeItems(items, m_realGame) end

-- Normalize and symmetrize promises through the reusable helper.
local function normalizePromises(promises) return VoxDeorumDealUtils.NormalizePromises(promises, m_realGame, GameDefines) end

-- Fingerprint ordinary items through the reusable helper.
local function itemFingerprint(items) return VoxDeorumDealUtils.ItemFingerprint(items, m_realGame) end

-- Fingerprint the full term set through the reusable helper.
local function semanticFingerprint(items, promises) return VoxDeorumDealUtils.SemanticFingerprint(items, promises, m_realGame, GameDefines) end

-- Convert one scratch iterator tuple back into the canonical deal schema.
local function itemFromScratch(itemType, duration, _, data1, data2, data3, flag1, fromPlayer)
	local other = fromPlayer == m_actorID and m_counterpartID or m_actorID
	local item = { fromPlayerID = fromPlayer, toPlayerID = other }
	if itemType == TradeableItems.TRADE_ITEM_GOLD then item.itemType, item.amount = "GOLD", data1
	elseif itemType == TradeableItems.TRADE_ITEM_GOLD_PER_TURN then item.itemType, item.amount, item.duration = "GOLD_PER_TURN", data1, duration
	elseif itemType == TradeableItems.TRADE_ITEM_MAPS then item.itemType = "MAPS"
	elseif itemType == TradeableItems.TRADE_ITEM_RESOURCES then item.itemType, item.resourceID, item.quantity, item.duration = "RESOURCES", data1, data2, duration
	elseif itemType == TradeableItems.TRADE_ITEM_CITIES then
		item.itemType = "CITIES"
		local plot = Map.GetPlot(data1, data2)
		local city = plot and plot:GetPlotCity() or nil
		item.cityID = city and city:GetOwner() == fromPlayer and city:GetID() or -1
	elseif itemType == TradeableItems.TRADE_ITEM_OPEN_BORDERS then item.itemType, item.duration = "OPEN_BORDERS", duration
	elseif itemType == TradeableItems.TRADE_ITEM_DEFENSIVE_PACT then item.itemType, item.duration = "DEFENSIVE_PACT", duration
	elseif itemType == TradeableItems.TRADE_ITEM_RESEARCH_AGREEMENT then item.itemType, item.duration = "RESEARCH_AGREEMENT", duration
	elseif itemType == TradeableItems.TRADE_ITEM_PEACE_TREATY then item.itemType, item.duration = "PEACE_TREATY", duration
	elseif itemType == TradeableItems.TRADE_ITEM_THIRD_PARTY_PEACE then item.itemType, item.thirdPartyTeamID, item.duration = "THIRD_PARTY_PEACE", data1, duration
	elseif itemType == TradeableItems.TRADE_ITEM_THIRD_PARTY_WAR then item.itemType, item.thirdPartyTeamID = "THIRD_PARTY_WAR", data1
	elseif itemType == TradeableItems.TRADE_ITEM_ALLOW_EMBASSY then item.itemType = "ALLOW_EMBASSY"
	elseif itemType == TradeableItems.TRADE_ITEM_DECLARATION_OF_FRIENDSHIP then item.itemType, item.duration = "DECLARATION_OF_FRIENDSHIP", duration
	elseif itemType == TradeableItems.TRADE_ITEM_VOTE_COMMITMENT then item.itemType, item.resolutionID, item.voteChoice, item.numVotes, item.repeal = "VOTE_COMMITMENT", data1, data2, data3, flag1
	elseif itemType == TradeableItems.TRADE_ITEM_TECHS then item.itemType, item.techID = "TECHS", data1
	elseif itemType == TradeableItems.TRADE_ITEM_VASSALAGE then item.itemType = "VASSALAGE"
	elseif itemType == TradeableItems.TRADE_ITEM_VASSALAGE_REVOKE then item.itemType = "VASSALAGE_REVOKE"
	else return nil end
	return normalizeItem(item)
end

-- Decode every ordinary term currently present in the real scratch deal.
local function itemsFromScratch()
	local items = {}
	m_realDeal:ResetIterator()
	while true do
		local itemType, duration, finalTurn, data1, data2, data3, flag1, fromPlayer = m_realDeal:GetNextItem()
		if itemType == nil then break end
		local item = itemFromScratch(itemType, duration, finalTurn, data1, data2, data3, flag1, fromPlayer)
		if item ~= nil then items[#items + 1] = item end
	end
	return normalizeItems(items)
end

local rebuildItems

-- Restore the authoritative draft when another scratch caller replaced its contents.
local function restoreUnexpectedScratch()
	if not m_mounted or m_rebuilding or m_nativeEditDirty or m_expectedScratchFingerprint == nil then return end
	local participantsChanged = m_realDeal:GetFromPlayer() ~= m_actorID or m_realDeal:GetToPlayer() ~= m_counterpartID
	if participantsChanged or itemFingerprint(itemsFromScratch()) ~= m_expectedScratchFingerprint then rebuildItems(m_draftItems, false) end
end

-- Mark proxy mutations without decoding scratch state inside native traversal.
local function beforeProxyOperation(isMutator)
	if not isMutator or m_rebuilding then return end
	if m_nativeBoundaryDepth == 0 then restoreUnexpectedScratch() end
	m_nativeEditDirty = true
end

-- Forward a native deal method while preserving the userdata as self.
local function makeForwarder(methodName, isMutator)
	-- Return a closure that preserves the native deal userdata as self.
	return function(_, ...)
		beforeProxyOperation(isMutator)
		return m_realDeal[methodName](m_realDeal, ...)
	end
end

-- Forward an Add constructor and force the trailing human-to-human override.
local function makeHumanAddForwarder(methodName)
	-- Return a closure that appends the authoritative h2h constructor flag.
	return function(_, ...)
		beforeProxyOperation(true)
		local args = { n = select("#", ...), ... }
		args.n = args.n + 1
		args[args.n] = true
		return m_realDeal[methodName](m_realDeal, unpack(args, 1, args.n))
	end
end

-- Preserve the native instance pointer needed when VP valuation passes the proxy to C++.
local dealProxy = { __instance = m_realDeal.__instance }

-- Supply the h2h flag in Lua stack slot nine used by the stage-3 binding.
function dealProxy:IsPossibleToTradeItem(fromPlayer, toPlayer, itemType, data1, data2, data3, flag1)
	beforeProxyOperation(false)
	return m_realDeal:IsPossibleToTradeItem(fromPlayer, toPlayer, itemType, data1, data2, data3, flag1, true)
end

-- Supply the h2h flag to the matching untradeable-reason query.
function dealProxy:GetReasonsItemUntradeable(fromPlayer, toPlayer, itemType, data1, data2, data3, flag1)
	beforeProxyOperation(false)
	return m_realDeal:GetReasonsItemUntradeable(fromPlayer, toPlayer, itemType, data1, data2, data3, flag1, true)
end

-- Add one canonical item to a specified deal surface through the adapted constructor set.
local function resolveItem(item, targetDeal)
	local giver = item.fromPlayerID
	local duration = durationForItem(item.itemType)
	if item.itemType == "GOLD" then targetDeal:AddGoldTrade(giver, item.amount or 0)
	elseif item.itemType == "GOLD_PER_TURN" then targetDeal:AddGoldPerTurnTrade(giver, item.amount or 0, duration)
	elseif item.itemType == "MAPS" then targetDeal:AddMapTrade(giver)
	elseif item.itemType == "RESOURCES" then targetDeal:AddResourceTrade(giver, item.resourceID or -1, item.quantity or 0, duration)
	elseif item.itemType == "CITIES" then targetDeal:AddCityTrade(giver, item.cityID or -1)
	elseif item.itemType == "OPEN_BORDERS" then targetDeal:AddOpenBorders(giver, duration)
	elseif item.itemType == "DEFENSIVE_PACT" then targetDeal:AddDefensivePact(giver, duration)
	elseif item.itemType == "RESEARCH_AGREEMENT" then targetDeal:AddResearchAgreement(giver, duration)
	elseif item.itemType == "PEACE_TREATY" then targetDeal:AddPeaceTreaty(giver, duration)
	elseif item.itemType == "THIRD_PARTY_PEACE" then targetDeal:AddThirdPartyPeace(giver, item.thirdPartyTeamID or -1, duration)
	elseif item.itemType == "THIRD_PARTY_WAR" then targetDeal:AddThirdPartyWar(giver, item.thirdPartyTeamID or -1)
	elseif item.itemType == "ALLOW_EMBASSY" then targetDeal:AddAllowEmbassy(giver)
	elseif item.itemType == "DECLARATION_OF_FRIENDSHIP" then targetDeal:AddDeclarationOfFriendship(giver)
	elseif item.itemType == "VOTE_COMMITMENT" then targetDeal:AddVoteCommitment(giver, item.resolutionID or -1, item.voteChoice or -1, item.numVotes or 1, item.repeal or false)
	elseif item.itemType == "TECHS" then targetDeal:AddTechTrade(giver, item.techID or -1)
	elseif item.itemType == "VASSALAGE" then targetDeal:AddVassalageTrade(giver)
	elseif item.itemType == "VASSALAGE_REVOKE" then targetDeal:AddRevokeVassalageTrade(giver)
	else return false end
	return true
end

-- Project a candidate item list transactionally and verify that every constructor succeeded.
rebuildItems = function(items, commit)
	local candidate = normalizeItems(items)
	m_rebuilding = true
	m_realDeal:ClearItems()
	m_realDeal:SetFromPlayer(m_actorID)
	m_realDeal:SetToPlayer(m_counterpartID)
	local recognized = true
	for _, item in ipairs(candidate) do if not resolveItem(item, dealProxy) then recognized = false break end end
	m_rebuilding = false
	local decoded = itemsFromScratch()
	local valid = recognized and #decoded == #candidate and itemFingerprint(decoded) == itemFingerprint(candidate)
	if valid then
		if commit then m_draftItems = candidate end
		m_expectedScratchFingerprint = itemFingerprint(candidate)
		m_nativeEditDirty = false
	end
	return valid
end

-- Apply one amount edit to a clone and commit only after an exact h2h rebuild.
local function changeAmount(itemType, giver, discriminator, amount)
	if m_nativeBoundaryDepth > 0 then return end
	local candidate = deepCopy(m_draftItems)
	local changed = false
	for _, item in ipairs(candidate) do
		if item.itemType == itemType and item.fromPlayerID == giver and (discriminator == nil or item.resourceID == discriminator) then
			if itemType == "RESOURCES" then item.quantity = amount else item.amount = amount end
			changed = true
			break
		end
	end
	if changed and rebuildItems(candidate, true) then return end
	rebuildItems(m_draftItems, false)
end

-- Rebuild a gold edit through the authoritative draft.
function dealProxy:ChangeGoldTrade(giver, amount) changeAmount("GOLD", giver, nil, amount) end

-- Rebuild a gold-per-turn edit through the authoritative draft.
function dealProxy:ChangeGoldPerTurnTrade(giver, amount) changeAmount("GOLD_PER_TURN", giver, nil, amount) end

-- Rebuild a resource edit through the authoritative draft.
function dealProxy:ChangeResourceTrade(giver, resourceID, amount) changeAmount("RESOURCES", giver, resourceID, amount) end

local humanAddMethods = {
	"AddGoldTrade", "AddGoldPerTurnTrade", "AddMapTrade", "AddResourceTrade", "AddCityTrade", "AddAllowEmbassy", "AddOpenBorders",
	"AddDefensivePact", "AddResearchAgreement", "AddPeaceTreaty", "AddThirdPartyPeace", "AddThirdPartyWar", "AddDeclarationOfFriendship",
	"AddVoteCommitment", "AddTechTrade", "AddVassalageTrade", "AddRevokeVassalageTrade",
}
for _, methodName in ipairs(humanAddMethods) do dealProxy[methodName] = makeHumanAddForwarder(methodName) end

-- Lazily forward all remaining deal calls and classify native item mutators.
setmetatable(dealProxy, { __index = function(proxy, methodName)
	local mutator = methodName == "ClearItems" or string.match(methodName, "^Remove") ~= nil or string.match(methodName, "^Change") ~= nil or string.match(methodName, "^Add") ~= nil
	local forwarder = makeForwarder(methodName, mutator)
	proxy[methodName] = forwarder
	return forwarder
end })

-- Return the proxy only while unchanged TradeLogic captures its scratch reference.
local function getProxyScratchDeal() return dealProxy end

-- Let unchanged TradeLogic capture only the proxy from a context-local UI facade.
local uiFacade = { GetScratchDeal = getProxyScratchDeal }
setmetatable(uiFacade, { __index = m_realUI })
UI = uiFacade
local tradeLogicLoaded, tradeLogicError = pcall(include, "TradeLogic")
UI = m_realUI
if not tradeLogicLoaded then
	print("Vox Deorum deal screen could not include TradeLogic: " .. tostring(tradeLogicError))
	-- Report the unavailable screen when a later panel action attempts to open it.
	local function reportUnavailableDealScreen()
		LuaEvents.VoxDeorumDiploPanelRestoreAfterDeal("TXT_KEY_VD_DEAL_ERROR_OPEN", false)
	end
	LuaEvents.VoxDeorumOpenDealScreen.Add(reportUnavailableDealScreen)
	return
end

local nativeDoUpdateButtons = DoUpdateButtons
local nativeDisplayDeal = DisplayDeal
local nativeDoClearTable = DoClearTable
local usPromisePocketIM = InstanceManager:new("VoxPromisePocketEntry", "Button", Controls.VoxUsPromisePocketStack)
local themPromisePocketIM = InstanceManager:new("VoxPromisePocketEntry", "Button", Controls.VoxThemPromisePocketStack)
local promiseTableIM = InstanceManager:new("VoxPromiseTableEntry", "Container", Controls.VoxPromiseTableStack)
local promiseTargetIM = InstanceManager:new("VoxPromiseTargetEntry", "Button", Controls.VoxTargetStack)

-- Put a localized or literal status in the wrapper-owned status area.
local function setStatus(text, literal)
	Controls.VoxStatusText:SetText(literal and tostring(text or "") or Locale.ConvertTextKey(text))
end

-- Return whether the bound actor still owns the effective UI seat.
local function actorIsCurrent()
	return m_actorID >= 0 and VoxDeorumSeat.EffectiveSeat() == m_actorID
end

-- Return whether one ID identifies a living major civilization.
local function isLivingMajor(playerID)
	local player = Players[playerID]
	return player ~= nil and player:IsAlive() and not player:IsMinorCiv() and not player:IsBarbarian()
end

-- Validate a promise against pair membership, duplicates, standing state, and coop-war rules.
local function validatePromise(promise, allPromises, ignoreDuplicate)
	local kind, promiser, recipient = promise.promiseType, promise.promiserID, promise.recipientID
	if promiseMetadata[kind] == nil or Players[promiser] == nil or Players[recipient] == nil or not isLivingMajor(m_counterpartID) then return false end
	if not ((promiser == m_actorID and recipient == m_counterpartID) or (promiser == m_counterpartID and recipient == m_actorID)) then return false end
	if not ignoreDuplicate then
		local count = 0
		for _, other in ipairs(allPromises or {}) do
			if other.promiseType == kind and other.promiserID == promiser and other.recipientID == recipient and other.targetPlayerID == promise.targetPlayerID then count = count + 1 end
		end
		if count > 1 then return false end
	end
	if kind == "MILITARY" and Players[recipient]:GetNumTurnsMilitaryPromise(promiser) >= 0 then return false end
	if kind == "EXPANSION" and Players[recipient]:GetNumTurnsExpansionPromise(promiser) >= 0 then return false end
	if kind == "BORDER" and Players[recipient]:GetNumTurnsBorderPromise(promiser) >= 0 then return false end
	if kind == "COOP_WAR" then
		local target = promise.targetPlayerID
		if not isLivingMajor(target) or target == m_actorID or target == m_counterpartID then return false end
		local actorTeam, counterpartTeam, targetTeam = Teams[Players[m_actorID]:GetTeam()], Teams[Players[m_counterpartID]:GetTeam()], Players[target]:GetTeam()
		if not actorTeam:IsHasMet(targetTeam) or not counterpartTeam:IsHasMet(targetTeam) then return false end
		if type(Players[m_actorID].IsValidCoopWarTarget) ~= "function" or type(Players[m_counterpartID].IsValidCoopWarTarget) ~= "function" then return false end
		local okA, eligibleA = pcall(Players[m_actorID].IsValidCoopWarTarget, Players[m_actorID], target, false)
		local okB, eligibleB = pcall(Players[m_counterpartID].IsValidCoopWarTarget, Players[m_counterpartID], target, false)
		if not okA or not okB or not eligibleA or not eligibleB then return false end
		local preparing = CoopWarStates and CoopWarStates.COOP_WAR_STATE_PREPARING
		if preparing ~= nil and (Players[m_actorID]:GetCoopWarAcceptedState(m_counterpartID, target) == preparing or Players[m_counterpartID]:GetCoopWarAcceptedState(m_actorID, target) == preparing) then return false end
	end
	return true
end

-- Validate the complete promise draft, including unique symmetric twins.
local function validatePromises(promises)
	local normalized = normalizePromises(promises)
	local seen = {}
	for _, promise in ipairs(normalized) do
		local key = stableKey(promise, promiseFields)
		if seen[key] or not validatePromise(promise, normalized, true) then return false end
		seen[key] = true
	end
	return true
end

-- Return a compact player name for a promise target row.
local function playerName(playerID)
	local player = Players[playerID]
	if player == nil then return tostring(playerID) end
	if player:IsHuman() and player:GetNickName() ~= "" then return player:GetNickName() end
	return Locale.ConvertTextKey(player:GetCivilizationShortDescriptionKey())
end

local refreshWrapper

-- Remove a visible promise row, including both cooperative-war twins.
local function removePromise(index)
	if m_mode == "view" or m_pending then return end
	local selected = m_draftPromises[index]
	if selected == nil then return end
	local kept = {}
	for _, promise in ipairs(m_draftPromises) do
		local remove = promise == selected
		if selected.promiseType == "COOP_WAR" and promise.promiseType == "COOP_WAR" and promise.targetPlayerID == selected.targetPlayerID then remove = true end
		if not remove then kept[#kept + 1] = promise end
	end
	m_draftPromises = normalizePromises(kept)
	refreshWrapper()
end

-- Add one directed promise or open the cooperative-war target chooser.
local function addPromise(promiserID, orderIndex)
	if m_mode == "view" or m_pending then return end
	local kind = promiseOrder[orderIndex]
	if kind == "COOP_WAR" then
		m_targetPromiserID = promiserID
		Controls.VoxTargetFrame:SetHide(false)
		refreshWrapper()
		return
	end
	local promise = normalizePromise({ promiserID = promiserID, recipientID = promiserID == m_actorID and m_counterpartID or m_actorID, promiseType = kind })
	local candidate = deepCopy(m_draftPromises)
	candidate[#candidate + 1] = promise
	if validatePromise(promise, candidate, false) then m_draftPromises = normalizePromises(candidate) else setStatus("TXT_KEY_VD_DEAL_ERROR_PROMISE_INVALID") end
	refreshWrapper()
end

-- Add one canonical symmetric cooperative-war pair from the target chooser.
local function addCoopWarTarget(targetID)
	if m_targetPromiserID == nil then return end
	local recipient = m_targetPromiserID == m_actorID and m_counterpartID or m_actorID
	local promise = normalizePromise({ promiserID = m_targetPromiserID, recipientID = recipient, promiseType = "COOP_WAR", targetPlayerID = targetID })
	local candidate = deepCopy(m_draftPromises)
	candidate[#candidate + 1] = promise
	if validatePromise(promise, normalizePromises(candidate), false) then m_draftPromises = normalizePromises(candidate) else setStatus("TXT_KEY_VD_DEAL_ERROR_PROMISE_INVALID") end
	m_targetPromiserID = nil
	Controls.VoxTargetFrame:SetHide(true)
	refreshWrapper()
end

-- Build the fixed promise inventory for one side.
local function buildPromisePocket(manager, promiserID)
	manager:ResetInstances()
	for index, kind in ipairs(promiseOrder) do
		local instance = manager:GetInstance()
		instance.Label:SetText(Locale.ConvertTextKey(promiseMetadata[kind].key))
		instance.Button:SetVoids(promiserID, index)
		instance.Button:RegisterCallback(Mouse.eLClick, addPromise)
		instance.Button:SetDisabled(m_mode == "view" or m_pending)
	end
	Controls.VoxUsPromisePocketStack:CalculateSize()
	Controls.VoxThemPromisePocketStack:CalculateSize()
	Controls.VoxUsPromisePocketPanel:CalculateInternalSize()
	Controls.VoxThemPromisePocketPanel:CalculateInternalSize()
end

-- Build the eligible cooperative-war target list without revealing unmet civilizations.
local function buildPromiseTargets()
	promiseTargetIM:ResetInstances()
	if m_targetPromiserID == nil then return end
	for playerID = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
		local probe = { promiserID = m_targetPromiserID, recipientID = m_targetPromiserID == m_actorID and m_counterpartID or m_actorID, promiseType = "COOP_WAR", targetPlayerID = playerID }
		if validatePromise(probe, { probe }, false) then
			local instance = promiseTargetIM:GetInstance()
			instance.Label:SetText(playerName(playerID))
			instance.Button:SetVoid1(playerID)
			instance.Button:RegisterCallback(Mouse.eLClick, addCoopWarTarget)
		end
	end
	Controls.VoxTargetStack:CalculateSize()
	Controls.VoxTargetPanel:CalculateInternalSize()
end

-- Render promise terms, showing one row for each symmetric cooperative war.
local function renderPromises()
	promiseTableIM:ResetInstances()
	local seenCoop = {}
	for index, promise in ipairs(m_draftPromises) do
		local coopKey = promise.promiseType == "COOP_WAR" and tostring(promise.targetPlayerID) or nil
		if coopKey == nil or not seenCoop[coopKey] then
			if coopKey ~= nil then seenCoop[coopKey] = true end
			local instance = promiseTableIM:GetInstance()
			local label = playerName(promise.promiserID) .. ": " .. Locale.ConvertTextKey(promiseMetadata[promise.promiseType].key)
			if promise.targetPlayerID ~= nil then label = label .. " " .. playerName(promise.targetPlayerID) end
			instance.Label:SetText(label)
			instance.Duration:SetText(promise.duration and Locale.ConvertTextKey("TXT_KEY_DIPLO_TURNS", promise.duration) or "")
			instance.Button:SetVoid1(index)
			instance.Button:RegisterCallback(Mouse.eLClick, removePromise)
			instance.Button:SetDisabled(m_mode == "view" or m_pending)
		end
	end
	Controls.VoxPromiseTableStack:CalculateSize()
	Controls.VoxPromiseTablePanel:CalculateInternalSize()
end

-- Set one native action button's label, visibility, enabled state, and wrapper kind.
local function configureButton(control, labelKey, kind, visible, enabled)
	control:SetHide(not visible)
	control:SetText(visible and Locale.ConvertTextKey(labelKey) or "")
	control:SetVoid1(kind or -1)
	control:SetDisabled(not enabled)
end

local actionKinds = { [1] = "propose", [2] = "cancel", [3] = "accept", [4] = "counter", [5] = "reject", [6] = "retract", [7] = "back" }

-- Return whether the incoming baseline remains safe to accept as-is.
local function canAccept()
	return m_mode == "incoming" and not m_pending and actorIsCurrent()
		and semanticFingerprint(m_draftItems, m_draftPromises) == semanticFingerprint(m_baselineItems, m_baselinePromises)
		and sanitizeMessage(m_outgoingMessage) == ""
end

-- Reapply all wrapper-owned controls after native valuation updates.
refreshWrapper = function()
	if not m_mounted then return end
	local editable = m_mode ~= "view" and not m_pending
	local hasTerms = #m_draftItems + #m_draftPromises > 0
	Controls.UsTableCover:SetHide(m_mode ~= "view")
	Controls.ThemTableCover:SetHide(m_mode ~= "view")
	Controls.UsPocketPanel:SetDisabled(not editable)
	Controls.ThemPocketPanel:SetDisabled(not editable)
	Controls.VoxPendingCover:SetHide(not m_pending)
	Controls.VoxMessageFrame:SetHide(m_mode == "view")
	Controls.VoxMessageInput:SetDisabled(not editable)
	Controls.WhatDoYouWantButton:SetHide(true)
	Controls.WhatWillYouGiveMeButton:SetHide(true)
	Controls.WhatWillMakeThisWorkButton:SetHide(true)
	Controls.WhatWillEndThisWarButton:SetHide(true)
	Controls.WhatConcessionsButton:SetHide(true)
	Controls.DenounceButton:SetHide(true)
	if m_mode == "author" then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_PROPOSE", 1, true, editable and hasTerms and actorIsCurrent())
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_CANCEL", 2, true, not m_pending)
		configureButton(Controls.VoxThirdAction, "", nil, false, false)
	elseif m_mode == "incoming" then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_ACCEPT", 3, true, canAccept())
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_COUNTER", 4, true, editable and hasTerms and actorIsCurrent())
		configureButton(Controls.VoxThirdAction, "TXT_KEY_VD_DEAL_ACTION_REJECT", 5, true, editable and actorIsCurrent())
	elseif m_mode == "own" then
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_COUNTER", 4, true, editable and hasTerms and actorIsCurrent())
		configureButton(Controls.CancelButton, "TXT_KEY_VD_DEAL_ACTION_RETRACT", 6, true, editable and actorIsCurrent())
		configureButton(Controls.VoxThirdAction, "", nil, false, false)
	else
		configureButton(Controls.ProposeButton, "TXT_KEY_VD_DEAL_ACTION_BACK", 7, true, not m_pending)
		configureButton(Controls.CancelButton, "", nil, false, false)
		configureButton(Controls.VoxThirdAction, "", nil, false, false)
	end
	buildPromisePocket(usPromisePocketIM, m_actorID)
	buildPromisePocket(themPromisePocketIM, m_counterpartID)
	renderPromises()
	buildPromiseTargets()
end

-- Synchronize a completed native edit back into the authoritative ordinary draft.
local function synchronizeNativeEdit()
	if m_rebuilding or not m_nativeEditDirty then return end
	m_draftItems = itemsFromScratch()
	m_expectedScratchFingerprint = itemFingerprint(m_draftItems)
	m_nativeEditDirty = false
end

-- Reconcile only at an outer wrapper boundary where no native iterator is active.
local function reconcileScratchBoundary()
	if not m_mounted or m_rebuilding or m_nativeBoundaryDepth > 0 then return end
	if m_nativeEditDirty then synchronizeNativeEdit() else restoreUnexpectedScratch() end
end

-- Run one native wrapper target while restoring the re-entry depth after errors.
local function runNativeBoundary(nativeFunction, argument)
	m_nativeBoundaryDepth = m_nativeBoundaryDepth + 1
	local ok, result
	if argument == nil then ok, result = pcall(nativeFunction) else ok, result = pcall(nativeFunction, argument) end
	m_nativeBoundaryDepth = m_nativeBoundaryDepth - 1
	if not ok then error(result) end
	return result
end

-- Preserve native valuation and display work, then reclaim wrapper action state.
function DoUpdateButtons()
	reconcileScratchBoundary()
	runNativeBoundary(nativeDoUpdateButtons)
	refreshWrapper()
end

-- Always classify columns against the effective seat captured for this mount.
function DisplayDeal()
	reconcileScratchBoundary()
	runNativeBoundary(nativeDisplayDeal, m_actorID)
end

-- Clear only native table instances and then restore wrapper layout.
function DoClearTable()
	reconcileScratchBoundary()
	runNativeBoundary(nativeDoClearTable)
	refreshWrapper()
end

-- Build an h2h legality tuple for one final-validation query.
local function itemLegality(item)
	local from, to, kind = item.fromPlayerID, item.toPlayerID, TradeableItems["TRADE_ITEM_" .. item.itemType]
	local duration = durationForItem(item.itemType)
	local standardDuration = defaultDealDuration()
	if kind == nil then return false end
	if item.itemType == "GOLD" then return dealProxy:IsPossibleToTradeItem(from, to, kind, item.amount, -1, -1, false)
	elseif item.itemType == "GOLD_PER_TURN" then return dealProxy:IsPossibleToTradeItem(from, to, kind, item.amount, duration, -1, false)
	elseif item.itemType == "MAPS" then return dealProxy:IsPossibleToTradeItem(from, to, kind, standardDuration, -1, -1, false)
	elseif item.itemType == "RESOURCES" then return dealProxy:IsPossibleToTradeItem(from, to, kind, item.resourceID, item.quantity, -1, false)
	elseif item.itemType == "CITIES" then
		local city = Players[from] and Players[from]:GetCityByID(item.cityID or -1)
		return city ~= nil and dealProxy:IsPossibleToTradeItem(from, to, kind, city:GetX(), city:GetY(), -1, false)
	elseif item.itemType == "THIRD_PARTY_PEACE" then return dealProxy:IsPossibleToTradeItem(from, to, kind, item.thirdPartyTeamID, duration, -1, false)
	elseif item.itemType == "THIRD_PARTY_WAR" then return dealProxy:IsPossibleToTradeItem(from, to, kind, item.thirdPartyTeamID, -1, -1, false)
	elseif item.itemType == "VOTE_COMMITMENT" then return dealProxy:IsPossibleToTradeItem(from, to, kind, item.resolutionID, item.voteChoice, item.numVotes, item.repeal)
	elseif item.itemType == "TECHS" then return dealProxy:IsPossibleToTradeItem(from, to, kind, item.techID, -1, -1, false)
	elseif item.itemType == "ALLOW_EMBASSY" then return dealProxy:IsPossibleToTradeItem(from, to, kind, standardDuration, -1, -1, false)
	elseif item.itemType == "VASSALAGE" or item.itemType == "VASSALAGE_REVOKE" then return dealProxy:IsPossibleToTradeItem(from, to, kind, -1, -1, -1, false)
	else return dealProxy:IsPossibleToTradeItem(from, to, kind, duration, -1, -1, false) end
end

-- Build a clean DealPayload v1 without rationale or server-owned display names.
local function serializeDraft()
	return { version = 1, items = deepCopy(normalizeItems(m_draftItems)), promises = deepCopy(normalizePromises(m_draftPromises)), message = sanitizeMessage(m_outgoingMessage) ~= "" and sanitizeMessage(m_outgoingMessage) or nil }
end

-- Clear all mounted state and restore the panel at most once.
local function resetScreenState(errorText, errorIsLiteral)
	local shouldRestorePanel = m_panelDemoted or errorText ~= nil
	m_rebuilding = true
	m_realDeal:ClearItems()
	m_rebuilding = false
	ContextPtr:ClearUpdate()
	UIManager:DequeuePopup(ContextPtr)
	ContextPtr:SetHide(true)
	Controls.VoxTargetFrame:SetHide(true)
	Controls.VoxPendingCover:SetHide(true)
	m_actorID, m_counterpartID, m_mode, m_proposalMessageID = -1, -1, nil, nil
	m_incomingMessage, m_outgoingMessage = "", ""
	m_baselineItems, m_baselinePromises, m_draftItems, m_draftPromises = {}, {}, {}, {}
	m_expectedScratchFingerprint, m_nativeEditDirty, m_mounted, m_pending, m_targetPromiserID = nil, false, false, false, nil
	m_pendingDotSeconds, m_pendingDotCount = 0, 0
	m_nativeBoundaryDepth = 0
	usPromisePocketIM:ResetInstances()
	themPromisePocketIM:ResetInstances()
	promiseTableIM:ResetInstances()
	promiseTargetIM:ResetInstances()
	m_panelDemoted = false
	if shouldRestorePanel then LuaEvents.VoxDeorumDiploPanelRestoreAfterDeal(errorText, errorIsLiteral == true) end
end

-- Close a successfully mounted screen through the common cleanup path.
local function closeScreen()
	resetScreenState()
end

-- Report an open failure to Lua.log and the still-mounted conversation panel.
local function failOpen(errorText, errorIsLiteral, logDetail)
	local visibleText = errorIsLiteral and tostring(errorText or "") or Locale.ConvertTextKey(errorText)
	print("Vox Deorum deal screen open failed: " .. tostring(logDetail or visibleText))
	if m_mounted then resetScreenState(errorText, errorIsLiteral)
	else LuaEvents.VoxDeorumDiploPanelRestoreAfterDeal(errorText, errorIsLiteral == true) end
end

-- Enter pending state and send one validated action to the replaceable driver.
local function dispatchAction(kind)
	if m_pending then return end
	if kind == "cancel" or kind == "back" then closeScreen() return end
	if not actorIsCurrent() then setStatus("TXT_KEY_VD_DEAL_ERROR_ACTOR_CHANGED") refreshWrapper() return end
	local action = { kind = kind }
	if kind == "propose" or kind == "counter" then
		if #m_draftItems + #m_draftPromises == 0 then setStatus("TXT_KEY_VD_DEAL_ERROR_EMPTY") return end
		if not rebuildItems(m_draftItems, true) then setStatus("TXT_KEY_VD_DEAL_ERROR_REBUILD") return end
		for _, item in ipairs(m_draftItems) do if not itemLegality(item) then setStatus("TXT_KEY_VD_DEAL_ERROR_REBUILD") return end end
		if not validatePromises(m_draftPromises) then setStatus("TXT_KEY_VD_DEAL_ERROR_PROMISE_INVALID") return end
		action.deal = serializeDraft()
		if kind == "counter" then action.proposalMessageID = m_proposalMessageID end
	elseif kind == "accept" then
		if not canAccept() then return end
		action.proposalMessageID = m_proposalMessageID
	elseif kind == "reject" or kind == "retract" then action.proposalMessageID = m_proposalMessageID
	end
	m_pending = true
	m_pendingDotSeconds, m_pendingDotCount = 0, 0
	setStatus("TXT_KEY_VD_DEAL_STATUS_PENDING")
	refreshWrapper()
	local driver = VoxDeorumDealUI and VoxDeorumDealUI.driver
	if driver ~= nil and driver.onAction ~= nil then driver.onAction(action)
	else VoxDeorumDealUI.resolve({ success = false, reason = Locale.ConvertTextKey("TXT_KEY_VD_DEAL_ERROR_NO_DRIVER") }) end
end

-- Map a button void to the wrapper action contract.
local function onActionButton(kindID)
	local kind = actionKinds[kindID]
	if kind ~= nil then dispatchAction(kind) end
end

-- Sanitize message edits live and update Accept protection immediately.
local function onMessageChanged()
	if m_settingMessage then return end
	local raw = Controls.VoxMessageInput:GetText()
	local clean = stripDelimiter(raw)
	if clean ~= raw then m_settingMessage = true Controls.VoxMessageInput:SetText(clean) m_settingMessage = false end
	m_outgoingMessage = clean
	refreshWrapper()
end

-- Resolve a delayed driver result without remounting or losing an errored draft.
local function resolveAction(result)
	if not m_mounted or not m_pending then return end
	if result ~= nil and (result.success == true or result.ok == true) then closeScreen() return end
	m_pending = false
	setStatus(result and result.reason or Locale.ConvertTextKey("TXT_KEY_VD_DEAL_MOCK_ERROR"), true)
	rebuildItems(m_draftItems, false)
	DisplayDeal()
	nativeDoUpdateButtons()
	refreshWrapper()
end

-- Own the single per-frame update used by pending animation and the active driver.
local function updateScreen(delta)
	if not m_mounted then return end
	if m_pending then
		m_pendingDotSeconds = m_pendingDotSeconds + delta
		local dotCount = math.floor(m_pendingDotSeconds / 0.35) % 4
		if dotCount ~= m_pendingDotCount then
			m_pendingDotCount = dotCount
			Controls.VoxStatusText:SetText(Locale.ConvertTextKey("TXT_KEY_VD_DEAL_STATUS_PENDING") .. string.rep(".", dotCount))
		end
	end
	local driver = VoxDeorumDealUI and VoxDeorumDealUI.driver
	if driver ~= nil and driver.onUpdate ~= nil then driver.onUpdate(delta) end
end

-- Validate and mount one explicit request-table contract.
local function openDealScreen(request)
	if type(request) ~= "table" then failOpen("TXT_KEY_VD_DEAL_ERROR_INVALID_REQUEST") return end
	local mode, counterpartID = request.mode, request.counterpartID
	if mode ~= "author" and mode ~= "incoming" and mode ~= "own" and mode ~= "view" then failOpen("TXT_KEY_VD_DEAL_ERROR_INVALID_REQUEST") return end
	local actorID = VoxDeorumSeat.EffectiveSeat()
	if not isInteger(counterpartID) or counterpartID == actorID or not isLivingMajor(counterpartID) or Players[actorID] == nil then failOpen("TXT_KEY_VD_DEAL_ERROR_INVALID_REQUEST") return end
	if (mode == "incoming" or mode == "own") and not isInteger(request.proposalMessageID) then failOpen("TXT_KEY_VD_DEAL_ERROR_INVALID_REQUEST") return end
	if mode == "view" and request.proposalMessageID ~= nil and not isInteger(request.proposalMessageID) then failOpen("TXT_KEY_VD_DEAL_ERROR_INVALID_REQUEST") return end
	if mode == "author" and request.deal ~= nil then failOpen("TXT_KEY_VD_DEAL_ERROR_INVALID_REQUEST") return end
	local source = mode == "author" and { version = 1, items = {}, promises = {} } or request.deal
	if not validateDealPayload(source, actorID, counterpartID) then failOpen("TXT_KEY_VD_DEAL_ERROR_INVALID_REQUEST") return end
	if m_mounted then closeScreen() end
	m_actorID, m_counterpartID, m_mode, m_proposalMessageID = actorID, counterpartID, mode, request.proposalMessageID
	source = deepCopy(source)
	m_incomingMessage = sanitizeMessage(source.message)
	m_outgoingMessage = mode == "own" and m_incomingMessage or ""
	m_baselineItems, m_baselinePromises = normalizeItems(source.items), normalizePromises(source.promises)
	m_draftItems, m_draftPromises = deepCopy(m_baselineItems), deepCopy(m_baselinePromises)
	m_pending, m_mounted, m_nativeEditDirty, m_targetPromiserID = false, true, false, nil
	Controls.VoxTargetFrame:SetHide(true)
	if not rebuildItems(m_draftItems, true) then failOpen("TXT_KEY_VD_DEAL_ERROR_REBUILD") return end
	m_panelDemoted = true
	LuaEvents.VoxDeorumDiploPanelDemoteForDeal()
	local gameFacade = {}
	setmetatable(gameFacade, { __index = m_realGame })
	-- Return the bound effective seat only during synthetic native entry.
	function gameFacade.GetActivePlayer() return m_actorID end
	Game = gameFacade
	-- Native entry queues this still-hidden context exactly once at LeaderTrade priority.
	local entered, enterError = pcall(LeaderMessageHandler, m_counterpartID, DiploUIStateTypes.DIPLO_UI_STATE_TRADE, m_incomingMessage, -1, -1)
	Game = m_realGame
	if not entered then failOpen("TXT_KEY_VD_DEAL_ERROR_OPEN", false, enterError) return end
	if not rebuildItems(m_draftItems, false) then failOpen("TXT_KEY_VD_DEAL_ERROR_REBUILD") return end
	DisplayDeal()
	nativeDoUpdateButtons()
	m_settingMessage = true
	Controls.VoxMessageInput:SetText(m_outgoingMessage)
	m_settingMessage = false
	Controls.DiscussionText:SetText(m_incomingMessage)
	setStatus("")
	refreshWrapper()
	ContextPtr:SetHide(false)
	ContextPtr:SetUpdate(updateScreen)
	local driver = VoxDeorumDealUI and VoxDeorumDealUI.driver
	if driver ~= nil and driver.onOpen ~= nil then driver.onOpen(request) end
end

-- Handle Escape entirely inside the wrapper so native diplomacy exits stay unreachable.
local function inputHandler(uiMsg, key)
	if uiMsg == KeyEvents.KeyDown and key == Keys.VK_ESCAPE and m_mounted and not m_pending then closeScreen() return true end
	return false
end

-- Keep engine popup hide notifications from invoking native close behavior.
local function showHideHandler(_, _) end

VoxDeorumDealUI = { driver = {}, resolve = resolveAction, open = openDealScreen, close = closeScreen, draft = serializeDraft }

if Events.ClearDiplomacyTradeTable.Remove ~= nil then Events.ClearDiplomacyTradeTable.Remove(DoClearDeal) end
Controls.ProposeButton:RegisterCallback(Mouse.eLClick, onActionButton)
Controls.CancelButton:RegisterCallback(Mouse.eLClick, onActionButton)
Controls.VoxThirdAction:RegisterCallback(Mouse.eLClick, onActionButton)
Controls.VoxMessageInput:RegisterCallback(onMessageChanged)
ContextPtr:SetInputHandler(inputHandler)
ContextPtr:SetShowHideHandler(showHideHandler)
LuaEvents.VoxDeorumOpenDealScreen.Add(openDealScreen)
LuaEvents.VoxDeorumDealActionResolved.Add(resolveAction)

include("VoxDeorumDealScreenMock")
