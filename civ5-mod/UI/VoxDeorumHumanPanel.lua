-- Vox Deorum human-control decision panel -- stage 7 (full Flavor-mode parity),
-- building on stage 5's trigger-button + hidable-dialog model and stage 6's
-- in-panel option list.
--
-- Auto-binds to VoxDeorumHumanPanel.xml. The addin always loads but stays
-- dormant until the strategist's present-decision tool fires
-- LuaEvents.VoxDeorumHumanDecision(playerID, turn, options). `options` is the
-- Flavor-mode OptionsReport delivered as a Lua table: present-decision hands the
-- report to the bridge as a structured value and the DLL converts it to a table
-- (ConvertJsonToLuaValue), so we read its fields directly -- no JSON parsing.
--
-- The decision does NOT pop the dialog open. Instead a single-line trigger
-- button appears in the native end-turn ("PLEASE WAIT") slot above the minimap
-- (alignToEndTurnButton copies that button's live geometry); the human clicks it
-- to OPEN the dialog, which marks the start of their deliberation.
--
-- The dialog is the approved mockup's master-detail layout: a leader context row
-- (the human civ only), a left nav of the six Flavor-mode categories -- Grand
-- Strategy, Flavors, Next Research, Next Policy, Persona, Relationships -- each
-- with a one-line summary and a staged-edits badge, a right pane rendering the
-- selected category from the report (single-select option lists for strategy/
-- research/policy, grouped slider rows for flavors/persona, per-met-civ cards
-- with Public/Private sliders for relationships), and a footer with a wrapping
-- staged-changes summary, the single per-turn rationale, Keep Status Quo, and
-- Submit. Every option carries the same descriptive text the LLM receives.
--
-- Staging mirrors the approved mockup: setting a control back to its current
-- value unstages the change; Submit needs >= 1 staged change plus a rationale
-- and fires ONE Game.BroadcastEvent("HumanDecision", ...) carrying only the
-- changed fields; Keep Status Quo (rationale only) uses a two-click confirm when
-- edits are staged. The human-strategist maps the payload onto set-flavors /
-- set-research / set-policy / set-persona / set-relationship with the shared
-- rationale. The panel renders nothing about civs other than the human's own
-- beyond met leaders' names/portraits with the human's OWN stance values.

include("IconSupport")  -- IconHookup, for tech/policy/leader/unique icons

local m_playerID = -1
local m_turn = -1
local m_options = nil                -- the turn's OptionsReport (Lua table)
local m_acceptedTimer = nil          -- nil when not animating the accepted state
local m_deliberationStarted = false  -- has the human opened the dialog this turn?
local m_deliberationSeconds = 0      -- seconds from first dialog open to submit
local m_lastRationale = ""           -- last submitted rationale, pre-filled next turn
local m_sqArmed = false              -- Keep Status Quo two-click confirm state
local ACCEPTED_HOLD_SECONDS = 2.5    -- how long the "submitted" overlay lingers

-- Staged (not yet submitted) changes -- deltas against the report's current
-- values, exactly like the approved mockup. Relationships are keyed by the
-- target playerID and hold the changed dimension(s) only.
local m_staged = { GrandStrategy = nil, Flavors = {}, Technology = nil, Policy = nil,
                   Persona = {}, Relationships = {} }

-- Met major civs for the Relationships pane, rebuilt each decision turn:
-- { { targetID, civName, leaderName }, ... } in player order.
local m_metCivs = {}

local m_activeCategory = "strategy"
local m_navItems = {}                -- { { id, ctrl }, ... } built once per decision
local m_groupOpen = {}               -- collapsible-group open state, by title key
local m_groupMetaRefreshers = {}     -- per-render group meta refresh closures
local onUpdate                       -- forward declaration; openDialog starts it

-- Lazily-built maps from a localized display name to its GameInfo row (for
-- icon art). The report keys techs/policies by the same localized name
-- (mcp-server's get-options uses the DB Description), so matching on
-- Locale.Lookup(row.Description) lines them up.
local m_nameToTech = nil
local m_nameToPolicy = nil
local m_nameToPolicyBranch = nil

-- Dormant on load: nothing shows until a decision turn.
ContextPtr:SetHide(true)

-- ============================================================ display helpers

-- Optional localization lookup: returns nil (instead of the raw tag) when the
-- key does not exist, so callers can fall back.
local function lookupOptional(tag, ...)
	local ok, text = pcall(Locale.ConvertTextKey, tag, ...)
	if not ok or text == nil or text == tag then return nil end
	return text
end

-- Plain-language label for a PascalCase report key (spec section 2: no
-- identifiers to memorize). Overrides live in VoxDeorum_Text.xml as
-- TXT_KEY_VD_HUMAN_NAME_<KEY>; everything else de-PascalCases cleanly.
local function displayNameFor(key)
	local text = lookupOptional("TXT_KEY_VD_HUMAN_NAME_" .. string.upper(key))
	if text ~= nil then return text end
	return (string.gsub(key, "(%l)(%u)", "%1 %2"))
end

-- The same descriptive text the LLM sees for a persona value (copied verbatim
-- from the set-persona tool schema into VoxDeorum_Text.xml -- the report does
-- not carry persona descriptions).
local function personaDescFor(key)
	return lookupOptional("TXT_KEY_VD_HUMAN_PERSONA_" .. string.upper(key)) or ""
end

-- Short policy label without the parenthetical display suffix; get-options
-- decorates option keys ("(Continuing X Branch)" / "(New Branch)") and the
-- current selection ("(Policy)" / "(New Branch)") differently, so comparisons
-- and compact labels both go through this.
local function stripSuffix(name)
	if name == nil then return nil end
	return (string.gsub(name, "%s*%(.-%)%s*$", ""))
end

-- Report newlines -> the markup Civ labels render.
local function toMarkup(text)
	return (string.gsub(tostring(text or ""), "[\r\n]+", "[NEWLINE]"))
end

-- ============================================================ report accessors

local function currentGrandStrategy()
	return m_options and m_options.Strategy and m_options.Strategy.GrandStrategy or nil
end

local function currentFlavor(key)
	local flavors = m_options and m_options.Strategy and m_options.Strategy.Flavors
	local value = flavors and tonumber(flavors[key])
	return value or 50
end

local function currentTech()
	local tech = m_options and m_options.Technology and m_options.Technology.Next
	if tech == nil or tech == "None" then return nil end
	return tech
end

local function currentPolicy()
	local policy = m_options and m_options.Policy and m_options.Policy.Next
	if policy == nil or policy == "None" then return nil end
	return policy
end

local function currentPersona(key)
	local persona = m_options and m_options.Persona
	local value = persona and tonumber(persona[key])
	return value or 5
end

local function currentRelationship(civName)
	local rel = m_options and m_options.Relationships and m_options.Relationships[civName]
	return {
		Public = rel and tonumber(rel.Public) or 0,
		Private = rel and tonumber(rel.Private) or 0,
		Rationale = rel and rel.Rationale or nil,
		UpdatedTurn = rel and tonumber(rel.UpdatedTurn) or nil,
	}
end

-- ====================================================== category definitions

-- Panel-only readability grouping; the LLM receives flavors as a flat list.
-- Groups are organized by human decision intent.
local FLAVOR_GROUPS = {
	{ titleKey = "TXT_KEY_VD_HUMAN_FLAVOR_GROUP_EXPANSION",
	  keys = { "Expansion", "Growth", "TileImprovement", "Infrastructure", "NavalGrowth",
	           "NavalTileImprovement", "WaterConnection" } },
	{ titleKey = "TXT_KEY_VD_HUMAN_FLAVOR_GROUP_ECONOMY",
	  keys = { "Production", "Gold", "Science", "Culture", "Happiness", "GreatPeople",
	           "Wonder", "Religion", "Diplomacy", "Spaceship", "Espionage" } },
	{ titleKey = "TXT_KEY_VD_HUMAN_FLAVOR_GROUP_DOCTRINE",
	  keys = { "Mobilization", "Offense", "Defense", "CityDefense", "MilitaryTraining", "UseNuke" } },
	{ titleKey = "TXT_KEY_VD_HUMAN_FLAVOR_GROUP_COMPOSITION",
	  keys = { "Recon", "Ranged", "Mobile", "Nuke", "Naval", "NavalRecon",
	           "Air", "AirCarrier", "Antiair", "Airlift" } },
}

-- Persona groups follow the section comments in set-persona's schema.
local PERSONA_GROUPS = {
	{ titleKey = "TXT_KEY_VD_HUMAN_PERSONA_GROUP_COMPETITIVENESS",
	  keys = { "VictoryCompetitiveness", "WonderCompetitiveness", "MinorCivCompetitiveness", "Boldness" } },
	{ titleKey = "TXT_KEY_VD_HUMAN_PERSONA_GROUP_WAR",
	  keys = { "WarBias", "HostileBias", "WarmongerHate", "NeutralBias", "FriendlyBias", "GuardedBias", "AfraidBias" } },
	{ titleKey = "TXT_KEY_VD_HUMAN_PERSONA_GROUP_DIPLOMACY",
	  keys = { "DiplomaticBalance", "Friendliness", "WorkWithWillingness", "WorkAgainstWillingness", "Loyalty" } },
	{ titleKey = "TXT_KEY_VD_HUMAN_PERSONA_GROUP_MINOR",
	  keys = { "MinorCivFriendlyBias", "MinorCivNeutralBias", "MinorCivHostileBias", "MinorCivWarBias" } },
	{ titleKey = "TXT_KEY_VD_HUMAN_PERSONA_GROUP_PERSONALITY",
	  keys = { "DenounceWillingness", "Forgiveness", "Meanness", "Neediness", "Chattiness", "DeceptiveBias" } },
}

local TICKS_FLAVOR = "TXT_KEY_VD_HUMAN_TICKS_FLAVOR"
local TICKS_PERSONA = "TXT_KEY_VD_HUMAN_TICKS_PERSONA"
local TICKS_REL = "TXT_KEY_VD_HUMAN_TICKS_REL"

-- =========================================================== staging plumbing

local function clearStaged()
	m_staged = { GrandStrategy = nil, Flavors = {}, Technology = nil, Policy = nil,
	             Persona = {}, Relationships = {} }
end

-- Stage a value into a keyed bucket, or unstage it when it equals the current
-- value (the mockup's stageValue).
local function stageValue(bucket, key, value, currentValue)
	if value == currentValue then
		m_staged[bucket][key] = nil
	else
		m_staged[bucket][key] = value
	end
end

local function countKeys(t)
	local n = 0
	if t then for _ in pairs(t) do n = n + 1 end end
	return n
end

-- Flat, ordered list of atomic staged changes as display strings -- used for
-- the footer summary, counting, and tooltips.
local function listChanges()
	local changes = {}
	local s = m_staged
	if s.GrandStrategy ~= nil then
		table.insert(changes, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_CAT_STRATEGY") .. ": "
			.. displayNameFor(currentGrandStrategy() or "None") .. " -> " .. displayNameFor(s.GrandStrategy))
	end
	for _, group in ipairs(FLAVOR_GROUPS) do
		for _, key in ipairs(group.keys) do
			if s.Flavors[key] ~= nil then
				table.insert(changes, displayNameFor(key) .. ": " .. currentFlavor(key) .. " -> " .. s.Flavors[key])
			end
		end
	end
	-- Flavors outside the known groups (future-proofing) still count.
	for key, value in pairs(s.Flavors) do
		local known = false
		for _, group in ipairs(FLAVOR_GROUPS) do
			for _, k in ipairs(group.keys) do if k == key then known = true end end
		end
		if not known then
			table.insert(changes, displayNameFor(key) .. ": " .. currentFlavor(key) .. " -> " .. value)
		end
	end
	if s.Technology ~= nil then
		table.insert(changes, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_CAT_RESEARCH") .. ": "
			.. (currentTech() or "None") .. " -> " .. s.Technology)
	end
	if s.Policy ~= nil then
		table.insert(changes, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_CAT_POLICY") .. ": "
			.. (stripSuffix(currentPolicy()) or "None") .. " -> " .. (stripSuffix(s.Policy) or s.Policy))
	end
	for _, group in ipairs(PERSONA_GROUPS) do
		for _, key in ipairs(group.keys) do
			if s.Persona[key] ~= nil then
				table.insert(changes, displayNameFor(key) .. ": " .. currentPersona(key) .. " -> " .. s.Persona[key])
			end
		end
	end
	for _, civ in ipairs(m_metCivs) do
		local rel = s.Relationships[civ.targetID]
		if rel ~= nil then
			local cur = currentRelationship(civ.civName)
			if rel.Public ~= nil then
				table.insert(changes, civ.civName .. " " .. Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_REL_PUBLIC")
					.. ": " .. cur.Public .. " -> " .. rel.Public)
			end
			if rel.Private ~= nil then
				table.insert(changes, civ.civName .. " " .. Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_REL_PRIVATE")
					.. ": " .. cur.Private .. " -> " .. rel.Private)
			end
		end
	end
	return changes
end

-- ======================================================== footer + nav state

local function hasRationale()
	local text = Controls.RationaleBox:GetText()
	return text ~= nil and string.match(text, "%S") ~= nil
end

-- Disarm the Keep Status Quo two-click confirm (any interaction other than the
-- arming click itself resets it).
local function disarmStatusQuo()
	if not m_sqArmed then return end
	m_sqArmed = false
	Controls.StatusQuoLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_KEEP_STATUS_QUO")
end

local function refreshButtons()
	local rationale = hasRationale()
	-- Keep Status Quo records a real decision, so it only needs a rationale.
	Controls.StatusQuoButton:SetDisabled(not rationale)
	-- Submit needs at least one staged change and a rationale.
	Controls.SubmitButton:SetDisabled(not (#listChanges() > 0 and rationale))
end

-- The wrapping staged-changes summary under the pane (undo happens where each
-- change was made: sliders have Reset, lists unstage by re-picking the current
-- option). The full list always rides in the tooltip.
local function refreshStagedLabel()
	local changes = listChanges()
	if #changes == 0 then
		Controls.StagedLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_STAGED_NONE")
		Controls.StagedLabel:SetToolTipString("")
		return
	end
	-- Cap the inline list to roughly three wrapped lines; the tooltip holds all.
	local shown, length, extra = {}, 0, 0
	for _, change in ipairs(changes) do
		if length + #change > 300 and #shown > 0 then
			extra = extra + 1
		else
			table.insert(shown, change)
			length = length + #change + 2
		end
	end
	local text = table.concat(shown, "; ")
	if extra > 0 then
		text = text .. " " .. Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_STAGED_MORE", extra)
	end
	Controls.StagedLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_STAGED_SOME", #changes, text)
	Controls.StagedLabel:SetToolTipString(table.concat(changes, "[NEWLINE]"))
end

-- Per-category one-line summaries for the left nav (current value, or the
-- staged-change count), mirroring the mockup.
local function categorySummary(id)
	local s = m_staged
	if id == "strategy" then
		local cur = displayNameFor(currentGrandStrategy() or "None")
		if s.GrandStrategy ~= nil then return cur .. " -> " .. displayNameFor(s.GrandStrategy) end
		return cur
	elseif id == "flavors" then
		local n = countKeys(s.Flavors)
		if n > 0 then return Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_CHANGES", n) end
		local total, customized = 0, 0
		local flavors = m_options and m_options.Strategy and m_options.Strategy.Flavors or {}
		for _, value in pairs(flavors) do
			total = total + 1
			if tonumber(value) ~= 50 then customized = customized + 1 end
		end
		return Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_FLAVORS", total, customized)
	elseif id == "research" then
		local cur = currentTech() or Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_NONE_QUEUED")
		if s.Technology ~= nil then return (currentTech() or "None") .. " -> " .. s.Technology end
		return cur
	elseif id == "policy" then
		local cur = stripSuffix(currentPolicy())
		if s.Policy ~= nil then return (cur or "None") .. " -> " .. (stripSuffix(s.Policy) or s.Policy) end
		return cur or Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_NONE_QUEUED")
	elseif id == "persona" then
		local n = countKeys(s.Persona)
		if n > 0 then return Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_CHANGES", n) end
		local total = 0
		for _, group in ipairs(PERSONA_GROUPS) do total = total + #group.keys end
		return Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_PERSONA", total)
	elseif id == "relations" then
		local n = countKeys(s.Relationships)
		if n > 0 then return Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_RELATIONS_CHANGED", n) end
		return Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_RELATIONS", #m_metCivs)
	end
	return ""
end

local function categoryChanged(id)
	local s = m_staged
	if id == "strategy" then return s.GrandStrategy ~= nil end
	if id == "flavors" then return countKeys(s.Flavors) > 0 end
	if id == "research" then return s.Technology ~= nil end
	if id == "policy" then return s.Policy ~= nil end
	if id == "persona" then return countKeys(s.Persona) > 0 end
	if id == "relations" then return countKeys(s.Relationships) > 0 end
	return false
end

local CATEGORIES = {
	{ id = "strategy",  titleKey = "TXT_KEY_VD_HUMAN_CAT_STRATEGY" },
	{ id = "flavors",   titleKey = "TXT_KEY_VD_HUMAN_CAT_FLAVORS" },
	{ id = "research",  titleKey = "TXT_KEY_VD_HUMAN_CAT_RESEARCH" },
	{ id = "policy",    titleKey = "TXT_KEY_VD_HUMAN_CAT_POLICY" },
	{ id = "persona",   titleKey = "TXT_KEY_VD_HUMAN_CAT_PERSONA" },
	{ id = "relations", titleKey = "TXT_KEY_VD_HUMAN_CAT_RELATIONS" },
}

-- Refresh nav texts, badges, and the active highlight in place (the nav is
-- built once per decision; rebuilding it on every slider tick would stutter).
local function refreshNav()
	for _, item in ipairs(m_navItems) do
		local title = Locale.ConvertTextKey(item.titleKey)
		if categoryChanged(item.id) then
			title = title .. " [COLOR_POSITIVE_TEXT][ICON_BULLET][ENDCOLOR]"
		end
		item.ctrl.NavTitle:SetText(title)
		item.ctrl.NavSummary:SetText(categorySummary(item.id))
		item.ctrl.ActiveHL:SetHide(item.id ~= m_activeCategory)
	end
end

-- Everything that reflects staged state, refreshed after any edit. Also
-- disarms the status-quo confirm: changing anything voids the pending discard.
local function updateShell()
	disarmStatusQuo()
	refreshNav()
	refreshStagedLabel()
	refreshButtons()
	for _, refresh in ipairs(m_groupMetaRefreshers) do refresh() end
end

-- ========================================================== pane construction

local function recalcPane()
	Controls.PaneStack:CalculateSize()
	Controls.PaneStack:ReprocessAnchoring()
	Controls.PaneScroll:CalculateInternalSize()
end

-- Plain wrapped-text row (intros, notes, empty states).
local function addText(text)
	local ctrl = {}
	ContextPtr:BuildInstanceForControl("TextInstance", ctrl, Controls.PaneStack)
	ctrl.Text:SetText(text)
	ctrl.Box:SetSizeY(ctrl.Text:GetSizeY() + 10)
	return ctrl
end

-- Single-select option list (grand strategy / research / policy). `entries` is
-- an ordered array of { key, name, help, hookIcon }; selecting the current key
-- unstages, anything else stages it via setStaged. Mirrors stage 6's research
-- list, generalized.
local function addOptionList(entries, currentKey, stagedKey, setStaged)
	local rows = {}
	local selected = stagedKey ~= nil and stagedKey or currentKey

	local function applySelection(key)
		for _, row in ipairs(rows) do
			row.ctrl.SelectionAnim:SetHide(row.key ~= key)
		end
	end

	for _, entry in ipairs(entries) do
		local ctrl = {}
		ContextPtr:BuildInstanceForControl("OptionInstance", ctrl, Controls.PaneStack)

		-- Icon (hide gracefully when the lookup fails, reclaiming the indent).
		local hasIcon = entry.hookIcon ~= nil and entry.hookIcon(ctrl.Icon) or false
		ctrl.Icon:SetHide(not hasIcon)
		if not hasIcon then
			ctrl.Name:SetOffsetVal(12, 7)
			ctrl.Help:SetOffsetVal(12, 32)
		end

		-- Name, with a "current" tag on the player's current selection.
		local nameText = entry.name
		if entry.key == currentKey then
			nameText = nameText .. " " .. Locale.Lookup("TXT_KEY_VD_HUMAN_CURRENT_TAG")
		end
		ctrl.Name:SetText(nameText)

		-- Help text (the same the LLM receives).
		ctrl.Help:SetText(entry.help or "")

		-- Size the row (and its highlights) to fit the wrapped help text.
		local rowH = math.max(58, 32 + ctrl.Help:GetSizeY() + 8)
		ctrl.Box:SetSizeY(rowH)
		ctrl.Button:SetSizeY(rowH)
		ctrl.SelectionAnim:SetSizeY(rowH)
		ctrl.SelectionAnimHL:SetSizeY(rowH)
		ctrl.MouseOverAnim:SetSizeY(rowH)
		ctrl.MouseOverAnimHL:SetSizeY(rowH)
		ctrl.SelectionAnim:SetHide(entry.key ~= selected)

		local key = entry.key
		ctrl.Button:RegisterCallback(Mouse.eLClick, function()
			setStaged(key ~= currentKey and key or nil)
			applySelection(key)
			updateShell()
		end)

		table.insert(rows, { key = key, ctrl = ctrl })
	end
end

-- Slider row used for flavors (0-100 step 5), persona (1-10 step 1), and
-- relationship dimensions (-100..100 step 5). Updates itself in place so
-- dragging is never interrupted by a re-render. cfg: { name, desc, min, max,
-- step, ticksKey, getCurrent, getStaged, setStaged }.
local function addSliderRow(cfg)
	local ctrl = {}
	ContextPtr:BuildInstanceForControl("SliderInstance", ctrl, Controls.PaneStack)

	-- Lay the slider line under the wrapped description (or directly under the
	-- name when there is none) and size the row to fit.
	local lineY = 26
	if cfg.desc ~= nil and cfg.desc ~= "" then
		ctrl.Desc:SetText(cfg.desc)
		lineY = 26 + ctrl.Desc:GetSizeY() + 4
	else
		ctrl.Desc:SetHide(true)
	end
	ctrl.MinusButton:SetOffsetVal(6, lineY)
	ctrl.ValueSlider:SetOffsetVal(44, lineY + 4)
	ctrl.PlusButton:SetOffsetVal(474, lineY)
	ctrl.ResetButton:SetOffsetVal(508, lineY)
	ctrl.Ticks:SetOffsetVal(44, lineY + 28)
	ctrl.Ticks:LocalizeAndSetText(cfg.ticksKey)
	ctrl.Box:SetSizeY(lineY + 48)

	local updating = false
	local span = cfg.max - cfg.min
	local steps = span / cfg.step

	local function shownValue()
		local staged = cfg.getStaged()
		if staged ~= nil then return staged end
		return cfg.getCurrent()
	end

	local function refresh()
		local cur = cfg.getCurrent()
		local staged = cfg.getStaged()
		updating = true
		ctrl.ValueSlider:SetValue((shownValue() - cfg.min) / span)
		updating = false
		if staged ~= nil then
			ctrl.Numbers:SetText(cur .. " -> [COLOR_POSITIVE_TEXT]" .. staged .. "[ENDCOLOR]")
			ctrl.Name:SetText(cfg.name .. " [COLOR_POSITIVE_TEXT][ICON_BULLET][ENDCOLOR]")
		else
			ctrl.Numbers:SetText(tostring(cur))
			ctrl.Name:SetText(cfg.name)
		end
	end

	local function setValue(value)
		value = math.max(cfg.min, math.min(cfg.max, value))
		cfg.setStaged(value)
		refresh()
		updateShell()
	end

	ctrl.ValueSlider:RegisterSliderCallback(function(fValue)
		if updating then return end
		local idx = math.floor(fValue * steps + 0.5)
		setValue(cfg.min + idx * cfg.step)
	end)
	ctrl.MinusButton:RegisterCallback(Mouse.eLClick, function() setValue(shownValue() - cfg.step) end)
	ctrl.PlusButton:RegisterCallback(Mouse.eLClick, function() setValue(shownValue() + cfg.step) end)
	ctrl.ResetButton:RegisterCallback(Mouse.eLClick, function()
		cfg.setStaged(cfg.getCurrent())  -- staging the current value unstages
		refresh()
		updateShell()
	end)

	refresh()
	return ctrl
end

-- Collapsible group header; member rows added after it are shown/hidden as a
-- unit (stacks skip hidden children). countChanged feeds the right-hand meta.
local function addGroup(titleKey, defaultOpen, memberCount, countChanged)
	local ctrl = {}
	ContextPtr:BuildInstanceForControl("GroupInstance", ctrl, Controls.PaneStack)
	ctrl.GroupTitle:LocalizeAndSetText(titleKey)
	if m_groupOpen[titleKey] == nil then m_groupOpen[titleKey] = defaultOpen end

	local group = { ctrl = ctrl, titleKey = titleKey, members = {} }

	local function applyVisibility()
		local open = m_groupOpen[titleKey]
		ctrl.Arrow:SetText(open and "-" or "+")
		for _, box in ipairs(group.members) do box:SetHide(not open) end
	end

	local function refreshMeta()
		local changed = countChanged ~= nil and countChanged() or 0
		if changed > 0 then
			ctrl.GroupMeta:SetText("[COLOR_POSITIVE_TEXT][ICON_BULLET] "
				.. Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_GROUP_META_CHANGED", changed) .. "[ENDCOLOR]")
		else
			ctrl.GroupMeta:LocalizeAndSetText("TXT_KEY_VD_HUMAN_GROUP_META_COUNT", memberCount)
		end
	end

	ctrl.Button:RegisterCallback(Mouse.eLClick, function()
		m_groupOpen[titleKey] = not m_groupOpen[titleKey]
		applyVisibility()
		recalcPane()
	end)

	group.applyVisibility = applyVisibility
	table.insert(m_groupMetaRefreshers, refreshMeta)
	refreshMeta()
	return group
end

-- ============================================================ icon-art lookups

-- Display-name -> GameInfo.Technologies row, for icons (stage 6).
local function buildTechMap()
	if m_nameToTech ~= nil then return end
	m_nameToTech = {}
	for row in GameInfo.Technologies() do
		local label = Locale.Lookup(row.Description)
		if label ~= nil and label ~= "" then
			m_nameToTech[label] = row
		end
	end
end

-- Display-name -> GameInfo.Policies row, plus branch display-name -> the
-- branch's free policy row (whose icon is the branch art), for policy icons.
local function buildPolicyMaps()
	if m_nameToPolicy ~= nil then return end
	m_nameToPolicy = {}
	m_nameToPolicyBranch = {}
	for row in GameInfo.Policies() do
		local label = Locale.Lookup(row.Description)
		if label ~= nil and label ~= "" then
			m_nameToPolicy[label] = row
		end
	end
	for branch in GameInfo.PolicyBranchTypes() do
		local label = Locale.Lookup(branch.Description)
		if label ~= nil and label ~= "" and branch.FreePolicy ~= nil then
			m_nameToPolicyBranch[label] = GameInfo.Policies[branch.FreePolicy]
		end
	end
end

local function techIconHook(name)
	buildTechMap()
	local row = m_nameToTech[name]
	if row == nil or IconHookup == nil then return nil end
	return function(icon) return IconHookup(row.PortraitIndex, 45, row.IconAtlas, icon) end
end

local function policyIconHook(displayKey)
	buildPolicyMaps()
	local base = stripSuffix(displayKey)
	local row = m_nameToPolicy[base] or m_nameToPolicyBranch[base]
	if row == nil or IconHookup == nil then return nil end
	return function(icon) return IconHookup(row.PortraitIndex, 45, row.IconAtlas, icon) end
end

-- ============================================================== pane renderers

local function renderStrategyPane()
	addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_STRATEGY_INTRO"))
	local strategy = m_options and m_options.Strategy
	if strategy ~= nil and strategy.Rationale ~= nil and strategy.Rationale ~= "" then
		addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_EARLIER_RATIONALE", strategy.Rationale))
	end

	local grandStrategies = m_options and m_options.Options and m_options.Options.GrandStrategies
	local names = {}
	if type(grandStrategies) == "table" then
		for name in pairs(grandStrategies) do table.insert(names, name) end
	end
	if #names == 0 then
		addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_PANE_EMPTY"))
		return
	end
	table.sort(names)

	local entries = {}
	for _, name in ipairs(names) do
		table.insert(entries, {
			key = name,
			name = displayNameFor(name),
			help = toMarkup(grandStrategies[name]),
		})
	end
	addOptionList(entries, currentGrandStrategy(), m_staged.GrandStrategy, function(key)
		m_staged.GrandStrategy = key
	end)
end

local function renderFlavorsPane()
	addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_FLAVORS_INTRO"))
	local descriptions = m_options and m_options.Options and m_options.Options.Flavors
	if type(descriptions) ~= "table" or next(descriptions) == nil then
		addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_PANE_EMPTY"))
		return
	end

	-- Grouped sliders; flavors the report carries but the groups don't know go
	-- into a trailing "other" group so nothing the LLM could touch is hidden.
	local seen = {}
	local function addFlavorGroup(titleKey, keys, defaultOpen)
		local present = {}
		for _, key in ipairs(keys) do
			if descriptions[key] ~= nil then table.insert(present, key) end
		end
		if #present == 0 then return end
		local group = addGroup(titleKey, defaultOpen, #present, function()
			local n = 0
			for _, key in ipairs(present) do
				if m_staged.Flavors[key] ~= nil then n = n + 1 end
			end
			return n
		end)
		for _, key in ipairs(present) do
			seen[key] = true
			local flavorKey = key
			local row = addSliderRow({
				name = displayNameFor(flavorKey),
				desc = toMarkup(descriptions[flavorKey]),
				min = 0, max = 100, step = 5, ticksKey = TICKS_FLAVOR,
				getCurrent = function() return currentFlavor(flavorKey) end,
				getStaged = function() return m_staged.Flavors[flavorKey] end,
				setStaged = function(v)
					if v == nil then v = currentFlavor(flavorKey) end
					stageValue("Flavors", flavorKey, v, currentFlavor(flavorKey))
				end,
			})
			table.insert(group.members, row.Box)
		end
		group.applyVisibility()
	end

	for index, group in ipairs(FLAVOR_GROUPS) do
		addFlavorGroup(group.titleKey, group.keys, index == 1)
	end
	local leftovers = {}
	for key in pairs(descriptions) do
		if not seen[key] then table.insert(leftovers, key) end
	end
	table.sort(leftovers)
	if #leftovers > 0 then
		addFlavorGroup("TXT_KEY_VD_HUMAN_GROUP_OTHER", leftovers, false)
	end
end

local function renderResearchPane()
	addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_RESEARCH_INTRO"))
	local techs = m_options and m_options.Options and m_options.Options.Technologies
	local names = {}
	if type(techs) == "table" then
		for name in pairs(techs) do table.insert(names, name) end
	end
	if #names == 0 then
		addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_RESEARCH_EMPTY"))
		return
	end

	-- Order by tech-tree column (era progression), then name, so the list reads
	-- early -> late like the tech tree rather than in hash order.
	buildTechMap()
	table.sort(names, function(a, b)
		local ra, rb = m_nameToTech[a], m_nameToTech[b]
		local ga = ra and ra.GridX or 999
		local gb = rb and rb.GridX or 999
		if ga ~= gb then return ga < gb end
		return a < b
	end)

	local current = currentTech()
	local currentRationale = m_options and m_options.Technology and m_options.Technology.Rationale
	local entries = {}
	for _, name in ipairs(names) do
		local help = toMarkup(techs[name])
		if name == current and currentRationale ~= nil and currentRationale ~= "" then
			help = Locale.Lookup("TXT_KEY_VD_HUMAN_EARLIER_RATIONALE", currentRationale)
				.. "[NEWLINE]" .. help
		end
		table.insert(entries, { key = name, name = name, help = help, hookIcon = techIconHook(name) })
	end
	addOptionList(entries, current, m_staged.Technology, function(key)
		m_staged.Technology = key
	end)
end

local function renderPolicyPane()
	addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_POLICY_INTRO"))
	local policies = m_options and m_options.Options and m_options.Options.Policies
	local names = {}
	if type(policies) == "table" then
		for name in pairs(policies) do table.insert(names, name) end
	end
	if #names == 0 then
		addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_PANE_EMPTY"))
		return
	end

	-- Continuing-a-branch options first, then new branches; alphabetical inside.
	local function isNewBranch(name)
		return string.find(name, "%(New Branch%)") ~= nil
	end
	table.sort(names, function(a, b)
		local na, nb = isNewBranch(a), isNewBranch(b)
		if na ~= nb then return nb end
		return a < b
	end)

	-- The current selection's display suffix differs between the option keys and
	-- Policy.Next ("(Continuing X Branch)" vs "(Policy)"), so match suffix-free.
	local current = currentPolicy()
	local currentBase = stripSuffix(current)
	local currentKey = nil
	for _, name in ipairs(names) do
		if currentBase ~= nil and stripSuffix(name) == currentBase then currentKey = name end
	end

	local currentRationale = m_options and m_options.Policy and m_options.Policy.Rationale
	local entries = {}
	for _, name in ipairs(names) do
		-- Help may arrive as a single string or an array of paragraphs.
		local helpValue = policies[name]
		if type(helpValue) == "table" then
			local parts = {}
			for _, part in ipairs(helpValue) do table.insert(parts, tostring(part)) end
			helpValue = table.concat(parts, "\n")
		end
		local help = toMarkup(helpValue)
		if name == currentKey and currentRationale ~= nil and currentRationale ~= "" then
			help = Locale.Lookup("TXT_KEY_VD_HUMAN_EARLIER_RATIONALE", currentRationale)
				.. "[NEWLINE]" .. help
		end
		table.insert(entries, { key = name, name = name, help = help, hookIcon = policyIconHook(name) })
	end
	addOptionList(entries, currentKey, m_staged.Policy, function(key)
		m_staged.Policy = key
	end)
end

local function renderPersonaPane()
	addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_PERSONA_INTRO"))
	local persona = m_options and m_options.Persona
	if type(persona) ~= "table" or next(persona) == nil then
		addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_PANE_EMPTY"))
		return
	end

	local seen = { Key = true, Rationale = true, GrandStrategy = true }
	local function addPersonaGroup(titleKey, keys, defaultOpen)
		local present = {}
		for _, key in ipairs(keys) do
			if tonumber(persona[key]) ~= nil then table.insert(present, key) end
		end
		if #present == 0 then return end
		local group = addGroup(titleKey, defaultOpen, #present, function()
			local n = 0
			for _, key in ipairs(present) do
				if m_staged.Persona[key] ~= nil then n = n + 1 end
			end
			return n
		end)
		for _, key in ipairs(present) do
			seen[key] = true
			local personaKey = key
			local row = addSliderRow({
				name = displayNameFor(personaKey),
				desc = personaDescFor(personaKey),
				min = 1, max = 10, step = 1, ticksKey = TICKS_PERSONA,
				getCurrent = function() return currentPersona(personaKey) end,
				getStaged = function() return m_staged.Persona[personaKey] end,
				setStaged = function(v)
					if v == nil then v = currentPersona(personaKey) end
					stageValue("Persona", personaKey, v, currentPersona(personaKey))
				end,
			})
			table.insert(group.members, row.Box)
		end
		group.applyVisibility()
	end

	for index, group in ipairs(PERSONA_GROUPS) do
		addPersonaGroup(group.titleKey, group.keys, index == 1)
	end
	local leftovers = {}
	for key, value in pairs(persona) do
		if not seen[key] and tonumber(value) ~= nil then table.insert(leftovers, key) end
	end
	table.sort(leftovers)
	if #leftovers > 0 then
		addPersonaGroup("TXT_KEY_VD_HUMAN_GROUP_OTHER", leftovers, false)
	end
end

local function renderRelationsPane()
	addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_RELATIONS_INTRO"))
	if #m_metCivs == 0 then
		addText(Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_REL_EMPTY"))
		return
	end

	for _, civ in ipairs(m_metCivs) do
		local ctrl = {}
		ContextPtr:BuildInstanceForControl("RelationInstance", ctrl, Controls.PaneStack)

		-- Leader portrait + names (recognition aids only -- spec section 3).
		local hasPortrait = false
		pcall(function()
			local leader = GameInfo.Leaders[Players[civ.targetID]:GetLeaderType()]
			if leader ~= nil and IconHookup ~= nil then
				hasPortrait = IconHookup(leader.PortraitIndex, 64, leader.IconAtlas, ctrl.Portrait)
			end
		end)
		ctrl.Portrait:SetHide(not hasPortrait)
		ctrl.Leader:SetText(Locale.ConvertTextKey("TXT_KEY_RANDOM_LEADER_CIV", civ.leaderName, civ.civName))

		local cur = currentRelationship(civ.civName)
		if cur.Rationale ~= nil and cur.Rationale ~= "" then
			ctrl.Note:LocalizeAndSetText("TXT_KEY_VD_HUMAN_REL_NOTE", cur.UpdatedTurn or 0, cur.Rationale)
		else
			ctrl.Note:LocalizeAndSetText("TXT_KEY_VD_HUMAN_REL_NOTE_NONE")
		end
		ctrl.Box:SetSizeY(math.max(76, 32 + ctrl.Note:GetSizeY() + 10))

		-- Public and Private stance sliders. set-relationship needs both
		-- dimensions, so submission folds the unchanged one in at its current
		-- value; staging only records what the human actually moved.
		local targetID = civ.targetID
		local civName = civ.civName
		for _, dim in ipairs({ "Public", "Private" }) do
			local dimKey = dim
			addSliderRow({
				name = Locale.ConvertTextKey(dimKey == "Public"
					and "TXT_KEY_VD_HUMAN_REL_PUBLIC" or "TXT_KEY_VD_HUMAN_REL_PRIVATE"),
				desc = "",
				min = -100, max = 100, step = 5, ticksKey = TICKS_REL,
				getCurrent = function() return currentRelationship(civName)[dimKey] end,
				getStaged = function()
					local rel = m_staged.Relationships[targetID]
					return rel and rel[dimKey] or nil
				end,
				setStaged = function(v)
					local cur2 = currentRelationship(civName)[dimKey]
					if v == nil then v = cur2 end
					local rel = m_staged.Relationships[targetID]
					if v == cur2 then
						if rel ~= nil then
							rel[dimKey] = nil
							if rel.Public == nil and rel.Private == nil then
								m_staged.Relationships[targetID] = nil
							end
						end
					else
						if rel == nil then
							rel = {}
							m_staged.Relationships[targetID] = rel
						end
						rel[dimKey] = v
					end
				end,
			})
		end
	end
end

local PANE_RENDERERS = {
	strategy = renderStrategyPane,
	flavors = renderFlavorsPane,
	research = renderResearchPane,
	policy = renderPolicyPane,
	persona = renderPersonaPane,
	relations = renderRelationsPane,
}

-- Rebuild the right pane for the active category. Slider drags never reach
-- here -- rows refresh themselves in place.
local function renderPane()
	m_groupMetaRefreshers = {}
	Controls.PaneStack:DestroyAllChildren()
	local renderer = PANE_RENDERERS[m_activeCategory]
	if renderer ~= nil then renderer() end
	recalcPane()
	Controls.PaneScroll:SetScrollValue(0)
end

local function selectCategory(id)
	disarmStatusQuo()
	m_activeCategory = id
	for _, category in ipairs(CATEGORIES) do
		if category.id == id then
			Controls.CategoryHeader:LocalizeAndSetText(category.titleKey)
		end
	end
	refreshNav()
	renderPane()
end

-- Build the left nav once per decision turn.
local function buildNav()
	Controls.NavStack:DestroyAllChildren()
	m_navItems = {}
	for _, category in ipairs(CATEGORIES) do
		local ctrl = {}
		ContextPtr:BuildInstanceForControl("NavInstance", ctrl, Controls.NavStack)
		local id = category.id
		ctrl.Button:RegisterCallback(Mouse.eLClick, function() selectCategory(id) end)
		table.insert(m_navItems, { id = id, titleKey = category.titleKey, ctrl = ctrl })
	end
	Controls.NavStack:CalculateSize()
	Controls.NavStack:ReprocessAnchoring()
end

-- ====================================================== leader context row

-- The human civ's leader portrait, trait, and unique components -- the same
-- data the EUI leader-choose dialog shows at pre-game, read from the game
-- database (only the human's own civ -- spec section 3). Wrapped in pcall so a
-- database surprise degrades to a blank row, never a broken panel.
local function populateLeaderContext()
	Controls.UniquesStack:DestroyAllChildren()
	local ok = pcall(function()
		local player = Players[m_playerID]
		local civ = GameInfo.Civilizations[player:GetCivilizationType()]
		local leader = GameInfo.Leaders[player:GetLeaderType()]

		Controls.LeaderName:SetText(Locale.ConvertTextKey("TXT_KEY_RANDOM_LEADER_CIV",
			Locale.Lookup(leader.Description), Locale.Lookup(civ.ShortDescription)))

		local hasPortrait = IconHookup ~= nil
			and IconHookup(leader.PortraitIndex, 64, leader.IconAtlas, Controls.LeaderPortrait) or false
		Controls.LeaderPortrait:SetHide(not hasPortrait)

		local traitLink = GameInfo.Leader_Traits{ LeaderType = leader.Type }()
		local trait = traitLink ~= nil and GameInfo.Traits[traitLink.TraitType] or nil
		if trait ~= nil then
			Controls.LeaderTraitName:SetText("[COLOR_POSITIVE_TEXT]" .. Locale.Lookup(trait.ShortDescription) .. "[ENDCOLOR]")
			local desc = Locale.Lookup(trait.Description)
			Controls.LeaderTraitDesc:SetText(desc)
			Controls.LeaderTraitDesc:SetToolTipString(desc)
		else
			Controls.LeaderTraitName:SetText("")
			Controls.LeaderTraitDesc:SetText("")
		end

		-- Unique unit/building/improvement icons with hover tooltips, like the
		-- pre-game leader dialog (PopulateUniques.lua's queries, via GameInfo).
		local function addUnique(item, replacesName)
			if item == nil then return end
			local ctrl = {}
			ContextPtr:BuildInstanceForControl("UniqueInstance", ctrl, Controls.UniquesStack)
			local hasIcon = IconHookup ~= nil
				and IconHookup(item.PortraitIndex, 45, item.IconAtlas, ctrl.Icon) or false
			ctrl.Icon:SetHide(not hasIcon)
			local tip = Locale.Lookup(item.Description)
			if replacesName ~= nil then
				tip = Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_UNIQUE_REPLACES", tip, replacesName)
			end
			if item.Help ~= nil then
				local help = Locale.Lookup(item.Help)
				if help ~= nil and help ~= "" and help ~= item.Help then
					tip = tip .. "[NEWLINE]" .. help
				end
			end
			ctrl.Icon:SetToolTipString(tip)
		end

		for row in GameInfo.Civilization_UnitClassOverrides{ CivilizationType = civ.Type } do
			if row.UnitType ~= nil then
				local unitClass = GameInfo.UnitClasses[row.UnitClassType]
				local defaultUnit = unitClass ~= nil and unitClass.DefaultUnit ~= nil
					and GameInfo.Units[unitClass.DefaultUnit] or nil
				addUnique(GameInfo.Units[row.UnitType],
					defaultUnit ~= nil and Locale.Lookup(defaultUnit.Description) or nil)
			end
		end
		for row in GameInfo.Civilization_BuildingClassOverrides{ CivilizationType = civ.Type } do
			if row.BuildingType ~= nil then
				local buildingClass = GameInfo.BuildingClasses[row.BuildingClassType]
				local defaultBuilding = buildingClass ~= nil and buildingClass.DefaultBuilding ~= nil
					and GameInfo.Buildings[buildingClass.DefaultBuilding] or nil
				addUnique(GameInfo.Buildings[row.BuildingType],
					defaultBuilding ~= nil and Locale.Lookup(defaultBuilding.Description) or nil)
			end
		end
		for row in GameInfo.Improvements{ CivilizationType = civ.Type } do
			addUnique(row, nil)
		end
	end)
	if not ok then
		Controls.LeaderName:SetText("")
		Controls.LeaderTraitName:SetText("")
		Controls.LeaderTraitDesc:SetText("")
		Controls.LeaderPortrait:SetHide(true)
	end
	Controls.UniquesStack:CalculateSize()
	Controls.UniquesStack:ReprocessAnchoring()
end

-- Met major civs, in player order. The report keys Relationships by the same
-- GetCivilizationShortDescription() the server stores, so names line up.
local function buildMetCivs()
	m_metCivs = {}
	local ok = pcall(function()
		local human = Players[m_playerID]
		local humanTeam = Teams[human:GetTeam()]
		for i = 0, GameDefines.MAX_MAJOR_CIVS - 1 do
			local player = Players[i]
			if player ~= nil and i ~= m_playerID and player:IsAlive()
				and humanTeam:IsHasMet(player:GetTeam()) then
				table.insert(m_metCivs, {
					targetID = i,
					civName = player:GetCivilizationShortDescription(),
					leaderName = player:GetName(),
				})
			end
		end
	end)
	if not ok then m_metCivs = {} end
end

-- ============================================================ submission path

-- Show/hide the dialog (dim backdrop + grid) as a unit, leaving the corner
-- trigger in place so a hidden dialog can be reopened.
local function setDialogShown(shown)
	Controls.DialogDim:SetHide(not shown)
	Controls.MainGrid:SetHide(not shown)
end

-- Open the dialog. The first open of a decision turn marks the start of the
-- human's deliberation. The update loop accumulates that time locally and the
-- HumanDecision payload reports it back to the strategist.
local function openDialog()
	if not m_deliberationStarted then
		m_deliberationStarted = true
		ContextPtr:SetUpdate(onUpdate)
	end
	disarmStatusQuo()
	setDialogShown(true)
end

-- Hide the dialog without discarding staged edits or the typed rationale; the
-- trigger button remains so the human can reopen it. The game stays paused.
local function hideDialog()
	disarmStatusQuo()
	setDialogShown(false)
end

-- Per-frame timer that retires the accepted overlay, swaps the trigger for the
-- auto-playing chip, and returns the participant to the auto-playing game.
function onUpdate(fDTime)
	if m_deliberationStarted and m_acceptedTimer == nil then
		m_deliberationSeconds = m_deliberationSeconds + fDTime
	end
	if m_acceptedTimer == nil then return end
	m_acceptedTimer = m_acceptedTimer - fDTime
	if m_acceptedTimer <= 0 then
		m_acceptedTimer = nil
		ContextPtr:ClearUpdate()
		setDialogShown(false)
		Controls.AcceptedOverlay:SetHide(true)
		Controls.TriggerButton:SetHide(true)
		Controls.AutoplayChip:SetHide(false)
	end
end

-- Drop our trigger into the native end-turn ("PLEASE WAIT") button's slot. EUI
-- repositions that button whenever the minimap resizes (MiniMapPanel.lua), so
-- rather than hardcode pixels we copy its live size and offset onto our widget,
-- effectively overriding it. The XML geometry is the fallback when the native
-- button can't be reached (non-EUI layout, or the cross-context lookup fails).
-- Wrapped in pcall so a missing control or method never breaks the panel.
local function alignToEndTurnButton()
	pcall(function()
		local endTurn = ContextPtr:LookUpControl("../WorldView/ActionInfoPanel/EndTurnButton")
		if endTurn == nil then return end
		local w, h = endTurn:GetSizeVal()
		local x, y = endTurn:GetOffsetVal()
		if not w or not h or w <= 0 or h <= 0 then return end
		local fallbackW = Controls.TriggerButton:GetSizeVal()
		if fallbackW ~= nil and w < fallbackW then w = fallbackW end
		Controls.TriggerButton:SetSizeVal(w, h)
		Controls.TriggerButton:SetOffsetVal(x, y)
		Controls.AutoplayChip:SetSizeVal(w, 38)
		Controls.AutoplayChip:SetOffsetVal(x, y)
	end)
end

-- Build the HumanDecision payload: required PlayerID/Turn/Rationale plus only
-- the changed fields (matching the registered schema and what human-strategist
-- maps onto the action tools).
local function buildPayload(statusQuo)
	local payload = {
		PlayerID  = m_playerID,
		Turn      = m_turn,
		Rationale = Controls.RationaleBox:GetText(),
		DeliberationMs = math.floor((m_deliberationSeconds * 1000) + 0.5),
	}
	if statusQuo then
		payload.StatusQuo = true
		return payload
	end
	local s = m_staged
	if s.GrandStrategy ~= nil then payload.GrandStrategy = s.GrandStrategy end
	if next(s.Flavors) ~= nil then
		payload.Flavors = {}
		for key, value in pairs(s.Flavors) do payload.Flavors[key] = value end
	end
	if s.Technology ~= nil then payload.Technology = s.Technology end
	if s.Policy ~= nil then payload.Policy = s.Policy end
	if next(s.Persona) ~= nil then
		payload.Persona = {}
		for key, value in pairs(s.Persona) do payload.Persona[key] = value end
	end
	-- set-relationship needs both dimensions, so the unchanged one rides along
	-- at its current value. Built in met-civ order as a proper array (the DLL
	-- serializes consecutive integer keys as a JSON array).
	local relationships = {}
	for _, civ in ipairs(m_metCivs) do
		local rel = s.Relationships[civ.targetID]
		if rel ~= nil then
			local cur = currentRelationship(civ.civName)
			table.insert(relationships, {
				TargetID = civ.targetID,
				Public = rel.Public ~= nil and rel.Public or cur.Public,
				Private = rel.Private ~= nil and rel.Private or cur.Private,
			})
		end
	end
	if #relationships > 0 then payload.Relationships = relationships end
	return payload
end

-- One-line summary of a submission for the accepted overlay / autoplay chip
-- (display names only -- spec section 2).
local function summarizePayload(payload)
	if payload.StatusQuo then
		return Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_STATUS_QUO")
	end
	local bits = {}
	if payload.GrandStrategy ~= nil then
		table.insert(bits, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_CAT_STRATEGY") .. " -> " .. displayNameFor(payload.GrandStrategy))
	end
	if payload.Technology ~= nil then
		table.insert(bits, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_CAT_RESEARCH") .. " -> " .. payload.Technology)
	end
	if payload.Policy ~= nil then
		table.insert(bits, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_CAT_POLICY") .. " -> " .. stripSuffix(payload.Policy))
	end
	if payload.Flavors ~= nil then
		table.insert(bits, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_BIT_FLAVORS", countKeys(payload.Flavors)))
	end
	if payload.Persona ~= nil then
		table.insert(bits, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_BIT_PERSONA", countKeys(payload.Persona)))
	end
	if payload.Relationships ~= nil then
		table.insert(bits, Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_SUM_BIT_RELS", #payload.Relationships))
	end
	local summary = {}
	for index, bit in ipairs(bits) do
		if index <= 3 then table.insert(summary, bit) end
	end
	local text = table.concat(summary, ", ")
	if #bits > 3 then
		text = text .. " " .. Locale.ConvertTextKey("TXT_KEY_VD_HUMAN_STAGED_MORE", #bits - 3)
	end
	return text
end

-- Show the accepted confirmation, then retire to the auto-playing chip.
local function enterAcceptedState(summary)
	Controls.AutoplayChipLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_AUTOPLAY_CHIP_DECISION", m_turn, summary)
	Controls.AcceptedSub:LocalizeAndSetText("TXT_KEY_VD_HUMAN_ACCEPTED_SUB_DECISION", summary)
	Controls.AcceptedOverlay:SetHide(false)
	m_acceptedTimer = ACCEPTED_HOLD_SECONDS
	ContextPtr:SetUpdate(onUpdate)
end

-- Fire the decision back to the strategist. Pass generateId = true so the DLL
-- attaches a real turn-scoped event id; HumanDecision flows through the
-- mcp-server's main event handling (unlike the id-less render-event
-- broadcasts), and an id-less event would crash its handler before the
-- decision ever reaches the strategist.
local function submit(statusQuo)
	if not hasRationale() then return end
	local payload = buildPayload(statusQuo)
	m_lastRationale = payload.Rationale
	Game.BroadcastEvent("HumanDecision", payload, true)
	enterAcceptedState(summarizePayload(payload))
end

local function onSubmitClicked()
	disarmStatusQuo()
	if #listChanges() == 0 or not hasRationale() then return end
	submit(false)
end

-- Keep Status Quo: a real decision (recorded with the human's rationale, never
-- the "[skipped]" sentinel). When edits are staged the first click arms a
-- "Discard N changes?" confirm on the button itself; the second click within
-- that state discards them and submits. Any other interaction disarms.
local function onStatusQuoClicked()
	if not hasRationale() then return end
	local changes = #listChanges()
	if changes > 0 and not m_sqArmed then
		m_sqArmed = true
		Controls.StatusQuoLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_KEEP_SQ_CONFIRM", changes)
		return
	end
	disarmStatusQuo()
	clearStaged()
	submit(true)
end

-- ================================================================ entry point

-- A decision is due: reset to the pending state, render everything from the
-- fresh report (so the panel pre-fills from the now-current state -- the
-- round-trip), and show the trigger button (NOT the dialog -- the human opens
-- it, starting the timer).
local function showPending(playerID, turn, options)
	m_playerID = playerID
	m_turn = turn
	m_options = options
	m_acceptedTimer = nil
	m_deliberationStarted = false
	m_deliberationSeconds = 0
	m_sqArmed = false
	clearStaged()
	ContextPtr:ClearUpdate()
	Controls.AcceptedOverlay:SetHide(true)
	Controls.AutoplayChip:SetHide(true)
	Controls.StatusQuoLabel:LocalizeAndSetText("TXT_KEY_VD_HUMAN_KEEP_STATUS_QUO")

	buildMetCivs()
	populateLeaderContext()
	buildNav()

	-- Pre-fill last turn's rationale so Keep Status Quo is not blocked on
	-- retyping a rationale every turn; the human can edit or replace it. The
	-- first decision (no prior rationale) starts empty and must be typed once.
	if m_lastRationale ~= "" then
		Controls.RationaleBox:SetText(m_lastRationale)
	else
		Controls.RationaleBox:ClearString()
	end
	selectCategory("strategy")
	updateShell()
	setDialogShown(false)
	alignToEndTurnButton()
	Controls.TriggerButton:SetHide(false)
	ContextPtr:SetHide(false)
end

-- Inbound: the strategist (via present-decision) signals a pending decision and
-- hands over the turn's options as a Lua table.
LuaEvents.VoxDeorumHumanDecision.Add(function(playerID, turn, options)
	showPending(playerID, turn, options)
end)

-- The rationale EditBox change callback fires as the participant types,
-- enabling the action buttons only once a rationale is present.
Controls.RationaleBox:RegisterCallback(function() refreshButtons() end)
Controls.StatusQuoButton:RegisterCallback(Mouse.eLClick, onStatusQuoClicked)
Controls.SubmitButton:RegisterCallback(Mouse.eLClick, onSubmitClicked)
Controls.TriggerButton:RegisterCallback(Mouse.eLClick, openDialog)
Controls.HideButton:RegisterCallback(Mouse.eLClick, hideDialog)

-- Escape hides the open dialog (back to the trigger) instead of falling through
-- to the game menu; while a submission is animating it is swallowed; and when
-- the dialog is already hidden it is left alone, so Escape behaves normally
-- while the human inspects the paused world.
local function inputHandler(uiMsg, wParam)
	if uiMsg == KeyEvents.KeyDown and wParam == Keys.VK_ESCAPE then
		if m_acceptedTimer ~= nil then
			return true
		end
		if not Controls.MainGrid:IsHidden() then
			hideDialog()
			return true
		end
	end
	return false
end
ContextPtr:SetInputHandler(inputHandler)
