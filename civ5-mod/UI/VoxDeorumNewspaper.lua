-- Vox Deorum newspaper reader -- stage 1 fixture proof viewer.
--
-- Auto-binds to VoxDeorumNewspaper.xml and stays hidden until
-- LuaEvents.VoxDeorumNewspaperOpen fires. The context is shown directly with
-- ContextPtr:SetHide(false), matching the HumanPanel pattern, so it does not sit
-- in UIManager's popup queue and cannot leave native popups hidden behind it.
--
-- The generated VoxDeorumNewspaperFixture.lua assigns one global:
--   VoxDeorumNewspaperFixture = { issue, bundle, assets, state, cacheRoot }
-- Field shapes are owned by vox-agents/src/newspaper/contracts/types.ts. This viewer reads
-- issue.pages, issue.items, bundle.profile, bundle.header, bundle.pages,
-- bundle.pages[].strips, bundle.pages[].actions, bundle.pages[].voteSlots,
-- bundle.header.tabs, and state.{activePageId,scrollByPage,votes}. The assets
-- map turns a strip fileName or vote asset id into an absolute DDS path.
--
-- Images are optional. Every strip path is checked with
-- Game.IsNewspaperTextureAvailable(cacheRoot, path, pixelWidth, pixelHeight)
-- before SetTexture. Missing binding, missing file, bad header, or wrong
-- dimensions keep the page on the native text fallback. The fallback still
-- renders every page, paragraph, typed link, and vote from structured data.

pcall(include, "VoxDeorumSeat")
include("VoxDeorumNewspaperData")

-- Page geometry in game control units. The render bundle is in CSS pixels, so
-- one scale factor converts every measured rectangle and image strip.
local CONTENT_X = 30
local HEADER_TOP = 52
local PAGE_TEXT_LEFT = 16
local PAGE_MIN_HEIGHT = 180
local STATUS_SECONDS = 4
local TAB_HEIGHT = 26
local LINE_GAP = 6

-- Fixture data. Issue and bundle are replaced when a new issue id loads.
local m_issue = nil
local m_bundle = nil
local m_assets = {}
local m_cacheRoot = nil
local m_itemsById = {}
local m_pages = {}
local m_pageById = {}
local m_pageIndexById = {}
local m_renderPages = {}
local m_activePageId = nil
local m_windowWidth = 1000
local m_windowHeight = 720
local m_contentWidth = 900

-- Reader state that survives closing and reopening this context.
local m_scrollByPage = {}
local m_votes = {}
local m_readerOpen = false
local m_detailOpen = false

-- Dynamic control ownership. Images are unloaded before their parents are
-- cleared, and the highlight lists drive shared vote state on the current page.
local m_headerImages = {}
local m_pageImages = {}
local m_voteHighlights = {}
local m_tabUnderlines = {}
local m_textureChecks = {}
local m_scale = 1
local m_statusSeconds = 0
local m_scrollRestoreFrames = 0

local onUpdate
local followLink
local dispatchAction
local selectPage
local closeReader

-- Page layout starts hidden. Nothing opens until a fixture event arrives.
ContextPtr:SetHide(true)
Controls.DialogDim:SetHide(true)
Controls.NewspaperGrid:SetHide(true)
Controls.DetailOverlay:SetHide(true)

-- ============================================================ localized chrome

-- Return a localization string, or an English fallback when the key is absent.
local function localizedOr(key, fallback)
	local ok, text = pcall(Locale.ConvertTextKey, key)
	if ok and type(text) == "string" and text ~= "" and text ~= key then return text end
	return fallback
end

-- Return a formatted localization string, or an English fallback.
local function localizedFormat(key, fallback, ...)
	local ok, text = pcall(Locale.ConvertTextKey, key, ...)
	if ok and type(text) == "string" and text ~= "" and text ~= key then return text end
	return string.format(fallback, ...)
end

-- Return the publication title, or a neutral reader label.
local function publicationTitle()
	if m_issue ~= nil and type(m_issue.publication) == "table" and type(m_issue.publication.title) == "string" then
		return m_issue.publication.title
	end
	return localizedOr("TXT_KEY_VD_NEWSPAPER_TITLE", "Newspaper")
end

-- ============================================================ texture safety

-- Return whether a DDS path passed the narrow file and header check.
local function textureAvailable(path, width, height)
	if type(path) ~= "string" or path == "" or type(m_cacheRoot) ~= "string" then return false end
	if type(width) ~= "number" or type(height) ~= "number" or width <= 0 or height <= 0 then return false end
	local key = path .. "|" .. tostring(width) .. "x" .. tostring(height)
	if m_textureChecks[key] ~= nil then return m_textureChecks[key] end

	local available = false
	local checker = nil
	if Game ~= nil then
		local ok, value = pcall(function() return Game.IsNewspaperTextureAvailable end)
		if ok and type(value) == "function" then checker = value end
	end
	if checker ~= nil then
		local ok, result = pcall(checker, m_cacheRoot, path, width, height)
		available = ok and result == true
	end
	m_textureChecks[key] = available
	return available
end

-- Return whether every strip in one region has a verified texture.
local function stripsAvailable(strips)
	if type(strips) ~= "table" or #strips == 0 then return false end
	for _, strip in ipairs(strips) do
		if type(strip) ~= "table" then return false end
		local path = m_assets[strip.fileName]
		if not textureAvailable(path, strip.pixelWidth, strip.pixelHeight) then return false end
	end
	return true
end

-- Return the exported vote icon edge in pixels for the bundle's raster scale.
local function voteIconPixelSize()
	local rasterScale = 1
	if type(m_bundle) == "table" and type(m_bundle.profile) == "table" then
		local value = tonumber(m_bundle.profile.rasterScale)
		if value ~= nil and value > 0 then rasterScale = value end
	end
	return math.max(1, math.floor(24 * rasterScale + 0.5))
end

-- Return whether every vote icon on one page passed the texture check.
local function voteIconsAvailable(page)
	local pixelSize = voteIconPixelSize()
	for _, slot in ipairs(page.voteSlots or {}) do
		if type(slot) == "table" then
			local neutral = m_assets[slot.neutralAssetId]
			local selected = m_assets[slot.selectedAssetId]
			if not textureAvailable(neutral, pixelSize, pixelSize) then return false end
			if not textureAvailable(selected, pixelSize, pixelSize) then return false end
		end
	end
	return true
end

-- Release one previously displayed texture without raising on older builds.
local function releaseImage(image)
	if image == nil then return end
	local ok, unload = pcall(function() return image.UnloadTexture end)
	if not ok or type(unload) ~= "function" then return end
	pcall(unload, image)
end

-- Release every image in a tracked list and empty the list.
local function releaseImages(images)
	for index = #images, 1, -1 do
		releaseImage(images[index])
		images[index] = nil
	end
end

-- Clear a dynamic container after releasing its displayed textures.
local function clearContainer(container, images)
	releaseImages(images)
	if container ~= nil then container:DestroyAllChildren() end
end

-- ============================================================ fixture adapter

-- Install publication indices while keeping issue data separate from render geometry.
local function indexIssue(issue)
	local indexed = VoxDeorumNewspaperData.IndexIssue(issue, m_bundle)
	m_itemsById = indexed.itemsById
	m_pages = indexed.pages
	m_pageById = indexed.pageById
	m_pageIndexById = indexed.pageIndexById
	m_renderPages = indexed.renderPages
end

-- Return whether a page id exists in the loaded issue.
local function hasPage(pageId)
	return type(pageId) == "string" and m_pageById[pageId] ~= nil
end

-- Load the generated fixture global and reset state only for a new issue.
local function loadFixture()
	local fixture = nil
	local ok, value = pcall(function() return VoxDeorumNewspaperFixture end)
	if ok then fixture = value end
	if type(fixture) ~= "table" then return false end
	if type(fixture.issue) ~= "table" or type(fixture.bundle) ~= "table" then return false end
	if type(fixture.issue.pages) ~= "table" or #fixture.issue.pages == 0 then return false end
	if type(fixture.issue.items) ~= "table" then return false end

	local issue = fixture.issue
	local newIssue = m_issue == nil or m_issue.issueId ~= issue.issueId
	m_issue = issue
	m_bundle = fixture.bundle
	m_assets = type(fixture.assets) == "table" and fixture.assets or {}
	m_cacheRoot = type(fixture.cacheRoot) == "string" and fixture.cacheRoot or nil
	m_textureChecks = {}
	indexIssue(issue)
	if #m_pages == 0 then return false end

	if newIssue then
		local initial = type(fixture.state) == "table" and fixture.state or {}
		m_votes = {}
		for itemId, vote in pairs(initial.votes or {}) do
			if (vote == "up" or vote == "down") and m_itemsById[itemId] ~= nil then
				m_votes[itemId] = vote
			end
		end
		m_scrollByPage = {}
		for pageId, offset in pairs(initial.scrollByPage or {}) do
			local number = tonumber(offset)
			if hasPage(pageId) and number ~= nil then m_scrollByPage[pageId] = math.max(0, number) end
		end
		m_activePageId = hasPage(initial.activePageId) and initial.activePageId or m_pages[1].id
	end

	if not hasPage(m_activePageId) then m_activePageId = m_pages[1].id end
	return true
end

-- Return the active page record.
local function activePage()
	return m_pageById[m_activePageId]
end

-- Return the current vote for an item, treating an absent entry as no vote.
local function getVote(itemId)
	local vote = m_votes[itemId]
	if vote == "up" or vote == "down" then return vote end
	return "none"
end

-- Toggle one item's vote and refresh every visible copy on the active page.
local function toggleVote(itemId, value)
	if itemId == nil or (value ~= "up" and value ~= "down") then return end
	if getVote(itemId) == value then
		m_votes[itemId] = nil
	else
		m_votes[itemId] = value
	end
	for _, direction in ipairs({ "up", "down" }) do
		local selected = getVote(itemId) == direction
		for _, entry in ipairs(m_voteHighlights[itemId .. "|" .. direction] or {}) do
			if entry.box ~= nil then entry.box:SetHide(not selected) end
			if entry.neutral ~= nil then
				entry.neutral:SetHide(selected)
				entry.selected:SetHide(not selected)
			end
		end
	end
end

-- ============================================================ status and scroll

-- Show one short explanation in the footer until the timer expires.
local function showStatus(text)
	Controls.StatusLabel:SetText(text or "")
	m_statusSeconds = STATUS_SECONDS
	ContextPtr:SetUpdate(onUpdate)
end

-- Return the pixel distance the active page can scroll.
local function scrollRange()
	local contentHeight = Controls.PageContent:GetSizeY()
	local viewportHeight = Controls.PageScroll:GetSizeY()
	return math.max(0, contentHeight - viewportHeight)
end

-- Save the active page's scroll offset in CSS pixels, matching fixture state.
local function saveScroll()
	if m_activePageId == nil then return end
	local range = scrollRange()
	m_scrollByPage[m_activePageId] = (Controls.PageScroll:GetScrollValue() * range) / m_scale
end

-- Restore one page's scroll offset after its content has been rebuilt.
local function restoreScroll(pageId)
	if pageId == nil then return end
	local offset = (m_scrollByPage[pageId] or 0) * m_scale
	local range = scrollRange()
	if range <= 0 then
		Controls.PageScroll:SetScrollValue(0)
		return
	end
	Controls.PageScroll:SetScrollValue(math.max(0, math.min(1, offset / range)))
end

-- ============================================================ content helpers

local inlineToText = VoxDeorumNewspaperData.InlineToText
local collectItemLinks = VoxDeorumNewspaperData.CollectItemLinks

-- Add a wrapped text block and return the next vertical cursor position.
local function addTextBlock(instanceName, parent, x, y, width, text)
	if type(text) ~= "string" or text == "" then return y end
	local instance = {}
	ContextPtr:BuildInstanceForControl(instanceName, instance, parent)
	instance.Text:SetText(text)
	instance.Text:SetWrapWidth(width)
	local height = math.max(18, instance.Text:GetSizeY())
	instance.Box:SetOffsetVal(x, y)
	instance.Box:SetSizeVal(width, height + 2)
	instance.Text:SetSizeVal(width, height)
	return y + height + LINE_GAP
end

-- Add one horizontal rule and return the next cursor position.
local function addRule(parent, x, y, width)
	local instance = {}
	ContextPtr:BuildInstanceForControl("RuleInstance", instance, parent)
	instance.Box:SetOffsetVal(x, y)
	instance.Box:SetSizeVal(width, 1)
	return y + 10
end

-- Add one typed link button and return the next cursor position.
local function addLinkButton(instanceName, parent, x, y, width, text, target)
	local instance = {}
	ContextPtr:BuildInstanceForControl(instanceName, instance, parent)
	instance.Button:SetOffsetVal(x, y)
	instance.Button:SetSizeVal(width, 24)
	instance.Label:SetText(text or "")
	instance.Label:SetTruncateWidth(math.max(20, width - 12))
	instance.Button:RegisterCallback(Mouse.eLClick, function() followLink(target) end)
	return y + 28
end

-- Add all of an item's typed links as a wrapping row and return the next cursor.
local function addLinkRow(parent, x, y, maxWidth, links)
	if #links == 0 then return y end
	local cursorX, cursorY = x, y
	for _, link in ipairs(links) do
		local width = math.max(90, math.min(maxWidth, #link.text * 7 + 28))
		if cursorX + width > x + maxWidth then
			cursorX = x
			cursorY = cursorY + 28
		end
		addLinkButton("LinkButtonInstance", parent, cursorX, cursorY, width, link.text, link.target)
		cursorX = cursorX + width + 6
	end
	return cursorY + 30
end

-- ============================================================ actions

-- Return the seat whose interface the reader follows.
local function activePlayerID()
	if VoxDeorumSeat ~= nil and type(VoxDeorumSeat.EffectiveSeat) == "function" then
		local ok, seat = pcall(VoxDeorumSeat.EffectiveSeat)
		if ok and type(seat) == "number" then return seat end
	end
	if Game ~= nil then
		local ok, active = pcall(Game.GetActivePlayer)
		if ok and type(active) == "number" then return active end
	end
	return nil
end

-- Return the object for the seat whose interface the reader follows.
local function activePlayer()
	local playerID = activePlayerID()
	if playerID == nil or Players == nil then return nil end
	return Players[playerID]
end

-- Find a major civilization's player by campaign id or numeric player id.
local function findCivilization(civilizationId)
	local playerID = tonumber(civilizationId)
	if playerID ~= nil and Players ~= nil then return Players[playerID] end
	if type(civilizationId) ~= "string" or GameInfoTypes == nil or GameDefines == nil then return nil end
	local civType = GameInfoTypes[civilizationId]
	if civType == nil then return nil end
	local maxPlayers = tonumber(GameDefines.MAX_MAJOR_CIVS) or 0
	for loopID = 0, maxPlayers - 1 do
		local player = Players[loopID]
		if player ~= nil then
			local ok, value = pcall(player.GetCivilizationType, player)
			if ok and value == civType then return player end
		end
	end
	return nil
end

-- Return one player's capital city, or nil when it has none.
local function capitalCity(player)
	if player == nil then return nil end
	local ok, city = pcall(player.GetCapitalCity, player)
	if ok then return city end
	return nil
end

-- Return one player's capital plot, or nil when it has no capital.
local function capitalPlot(player)
	local city = capitalCity(player)
	if city == nil then return nil end
	local ok, plot = pcall(city.Plot, city)
	if ok then return plot end
	return nil
end

-- Hide the reader for a native screen while preserving page, scroll, and votes.
local function hideForGameScreen()
	if m_readerOpen then closeReader() end
end

-- Show a status message for a target that cannot be resolved.
local function unavailableTarget()
	showStatus(localizedOr("TXT_KEY_VD_NEWSPAPER_TARGET_UNAVAILABLE", "That target is not available in this game."))
end

-- Open embedded earlier coverage or an article from the current issue.
local function openArticle(target)
	if type(target) ~= "table" then unavailableTarget(); return end
	local item = nil
	for _, source in ipairs(m_issue.items or {}) do
		local history = source.history
		if type(history) == "table" and type(history.target) == "table"
			and history.target.issueId == target.issueId and history.target.itemId == target.itemId then
			item = { headline = { { type = "text", text = history.label } }, body = history.body }
			break
		end
	end
	if item == nil and (target.issueId == nil or target.issueId == m_issue.issueId) then item = m_itemsById[target.itemId] end
	if item == nil then unavailableTarget(); return end

	clearContainer(Controls.DetailContent, {})
	Controls.DetailTitle:SetText(inlineToText(item.headline))
	local y = 4
	for _, block in ipairs(item.body or {}) do
		y = addTextBlock("TextInstance", Controls.DetailContent, 10, y, m_contentWidth - 50, inlineToText(block)) + 4
	end
	y = addTextBlock("TextInstance", Controls.DetailContent, 10, y, m_contentWidth - 50, inlineToText(item.record))
	y = addLinkRow(Controls.DetailContent, 10, y + 4, m_contentWidth - 50, collectItemLinks(item))
	Controls.DetailContent:SetSizeVal(m_contentWidth - 30, math.max(1, y + 10))
	Controls.DetailScroll:CalculateInternalSize()
	Controls.DetailScroll:SetScrollValue(0)
	Controls.DetailOverlay:SetHide(false)
	m_detailOpen = true
end

-- Close the article detail overlay without changing the active page.
local function closeArticle()
	Controls.DetailOverlay:SetHide(true)
	m_detailOpen = false
	clearContainer(Controls.DetailContent, {})
end

-- Decline city links until publication IDs have an explicit owner and game-city mapping.
local function openCity()
	-- GetCityByID is scoped to a player and also accepts sequential city indices.
	-- Fixture city IDs cannot identify a unique native city.
	unavailableTarget()
end

-- Focus a civilization link on its capital.
local function openCivilization(civilizationId)
	local player = findCivilization(civilizationId)
	local plot = capitalPlot(player)
	if plot == nil or UI == nil or type(UI.LookAt) ~= "function" then unavailableTarget(); return end
	hideForGameScreen()
	pcall(UI.LookAt, plot, 0)
end

-- Return the native popup type for one overview screen, or nil when unavailable.
local function screenPopupType(screen)
	if ButtonPopupTypes == nil then return nil end
	if screen == "trade" then return ButtonPopupTypes.BUTTONPOPUP_TRADE_ROUTE_OVERVIEW end
	if screen == "culture" then return ButtonPopupTypes.BUTTONPOPUP_CULTURE_OVERVIEW end
	if screen == "diplomacy" then return ButtonPopupTypes.BUTTONPOPUP_DIPLOMATIC_OVERVIEW end
	if screen == "military" then return ButtonPopupTypes.BUTTONPOPUP_MILITARY_OVERVIEW end
	return nil
end

-- Open one supported game screen from a typed link.
local function openScreen(screen)
	if screen == "city" or screen == "map" then
		local plot = capitalPlot(activePlayer())
		local opener = nil
		if UI ~= nil then
			if screen == "city" then
				opener = UI.DoSelectCityAtPlot
			else
				opener = UI.LookAt
			end
		end
		if plot == nil or type(opener) ~= "function" then unavailableTarget(); return end
		hideForGameScreen()
		if screen == "city" then
			pcall(opener, plot)
		else
			pcall(opener, plot, 0)
		end
		return
	end

	local popupType = screenPopupType(screen)
	if popupType == nil or Events == nil or Events.SerialEventGameMessagePopup == nil then
		unavailableTarget()
		return
	end
	local info = { Type = popupType, Data1 = 1 }
	if screen == "culture" then info.Data2 = 4 end
	hideForGameScreen()
	pcall(Events.SerialEventGameMessagePopup, info)
end

-- Open the trade route overview for a trade relationship link.
local function openTradeRelationship()
	openScreen("trade")
end

-- Dispatch one typed link target emitted by the renderer.
followLink = function(target)
	if type(target) ~= "table" then unavailableTarget(); return end
	if target.type == "article" then
		openArticle(target)
	elseif target.type == "city" then
		openCity(target.cityId)
	elseif target.type == "civilization" then
		openCivilization(target.civilizationId)
	elseif target.type == "trade-relationship" then
		openTradeRelationship()
	elseif target.type == "screen" then
		openScreen(target.screen)
	else
		unavailableTarget()
	end
end

-- ============================================================ header rendering

-- Add one already verified texture at a scaled rectangle.
local function addImage(parent, images, path, x, y, width, height)
	if type(path) ~= "string" or width <= 0 or height <= 0 then return nil end
	local instance = {}
	ContextPtr:BuildInstanceForControl("ImageInstance", instance, parent)
	instance.Image:SetOffsetVal(x, y)
	instance.Image:SetSizeVal(width, height)
	instance.Image:SetTexture(path)
	images[#images + 1] = instance.Image
	return instance.Image
end

-- Add one verified image strip at a scaled CSS rectangle.
local function addStrip(parent, images, strip)
	local clip = strip.clip or {}
	local x = (tonumber(clip.x) or 0) * m_scale
	local y = (tonumber(clip.y) or 0) * m_scale
	local width = (tonumber(clip.width) or 0) * m_scale
	local height = (tonumber(clip.height) or 0) * m_scale
	local image = addImage(parent, images, m_assets[strip.fileName], x, y, width, height)
	if image ~= nil then
		-- Native CultureOverview crops partial icons with these texture-region APIs.
		image:SetTextureOffsetVal(0, 0)
		image:SetTextureSizeVal(clip.width * m_bundle.profile.rasterScale, clip.height * m_bundle.profile.rasterScale)
		image:NormalizeTexture()
	end
end

-- Add one transparent button over a scaled bundle rectangle.
local function addHitRect(instanceName, parent, rect, callback)
	if type(rect) ~= "table" then return end
	local x = (tonumber(rect.x) or 0) * m_scale
	local y = (tonumber(rect.y) or 0) * m_scale
	local width = math.max(8, (tonumber(rect.width) or 0) * m_scale)
	local height = math.max(8, (tonumber(rect.height) or 0) * m_scale)
	local instance = {}
	ContextPtr:BuildInstanceForControl(instanceName, instance, parent)
	instance.Box:SetOffsetVal(x, y)
	instance.Box:SetSizeVal(width, height)
	instance.Button:SetSizeVal(width, height)
	instance.HoverAnim:SetSizeVal(width, height)
	instance.HoverHL:SetSizeVal(width, height)
	if instance.SelectedHL ~= nil then instance.SelectedHL:SetSizeVal(width, height) end
	instance.Button:RegisterCallback(Mouse.eLClick, callback)
	return instance
end

-- Add one tab underline at a scaled header rectangle.
local function addTabUnderline(rect)
	local instance = {}
	ContextPtr:BuildInstanceForControl("RuleInstance", instance, Controls.HeaderOverlay)
	local x = (tonumber(rect.x) or 0) * m_scale
	local y = ((tonumber(rect.y) or 0) + (tonumber(rect.height) or 0)) * m_scale - 3
	local width = (tonumber(rect.width) or 0) * m_scale
	instance.Box:SetOffsetVal(x, y)
	instance.Box:SetSizeVal(math.max(1, width), 3)
	return instance.Box
end

-- Add one header action overlay from the bundle.
local function addHeaderAction(action)
	for _, rect in ipairs(action.rects or {}) do
		addHitRect("HeaderHitInstance", Controls.HeaderOverlay, rect, function() dispatchAction(action.action) end)
	end
end

-- Show the selected page's tab underline in both header modes.
local function updateTabSelection()
	for pageId, underline in pairs(m_tabUnderlines) do
		underline:SetHide(pageId ~= m_activePageId)
	end
end

-- Build the native tabs used when the masthead image cannot be verified.
local function renderTextHeader()
	Controls.HeaderImage:SetHide(true)
	Controls.HeaderOverlay:SetHide(true)
	Controls.HeaderTitle:SetOffsetVal(CONTENT_X, HEADER_TOP + 2)
	Controls.HeaderTitle:SetWrapWidth(m_contentWidth)
	Controls.HeaderTitle:SetText(publicationTitle())
	Controls.HeaderTitle:SetHide(false)
	Controls.HeaderTabs:SetOffsetVal(CONTENT_X, HEADER_TOP + 40)
	Controls.HeaderTabs:SetHide(false)
	Controls.HeaderTabs:DestroyAllChildren()
	m_tabUnderlines = {}

	for _, page in ipairs(m_pages) do
		local capturedPage = page
		local instance = {}
		ContextPtr:BuildInstanceForControl("TabButtonInstance", instance, Controls.HeaderTabs)
		local label = tostring(capturedPage.label or capturedPage.id or "")
		local width = math.max(96, math.min(190, #label * 8 + 28))
		instance.Button:SetSizeVal(width, TAB_HEIGHT)
		instance.Label:SetText(label)
		instance.Label:SetTruncateWidth(width - 12)
		instance.Underline:SetSizeVal(width, 2)
		instance.Button:RegisterCallback(Mouse.eLClick, function() selectPage(capturedPage.id) end)
		m_tabUnderlines[capturedPage.id] = instance.Underline
	end

	Controls.HeaderTabs:CalculateSize()
	Controls.HeaderTabs:ReprocessAnchoring()
	updateTabSelection()
	return 46 + Controls.HeaderTabs:GetSizeY() + 8
end

-- Build the masthead image, tabs, and header actions, or the native fallback.
local function renderHeader()
	clearContainer(Controls.HeaderImage, m_headerImages)
	clearContainer(Controls.HeaderOverlay, {})
	Controls.HeaderTabs:DestroyAllChildren()
	m_tabUnderlines = {}
	m_headerImages = {}
	m_textureChecks = {}

	local header = m_bundle.header
	if type(header) ~= "table" or not stripsAvailable(header.strips) then
		return renderTextHeader()
	end

	local width = (tonumber(header.width) or m_contentWidth) * m_scale
	local height = (tonumber(header.height) or 96) * m_scale
	Controls.HeaderImage:SetOffsetVal(CONTENT_X, HEADER_TOP)
	Controls.HeaderImage:SetSizeVal(width, height)
	Controls.HeaderImage:SetHide(false)
	for _, strip in ipairs(header.strips) do addStrip(Controls.HeaderImage, m_headerImages, strip) end

	Controls.HeaderTitle:SetHide(true)
	Controls.HeaderTabs:SetHide(true)
	Controls.HeaderOverlay:SetOffsetVal(CONTENT_X, HEADER_TOP)
	Controls.HeaderOverlay:SetSizeVal(width, height)
	Controls.HeaderOverlay:SetHide(false)

	for _, action in ipairs(header.actions or {}) do
		-- Tabs below already own the select-page hit regions.
		if type(action.action) == "table" and action.action.type ~= "select-page" then addHeaderAction(action) end
	end
	for _, tab in ipairs(header.tabs or {}) do
		local capturedTab = tab
		if type(capturedTab) == "table" and type(capturedTab.pageId) == "string" and type(capturedTab.rect) == "table" then
			m_tabUnderlines[capturedTab.pageId] = addTabUnderline(capturedTab.rect)
			addHitRect("HeaderHitInstance", Controls.HeaderOverlay, capturedTab.rect, function() selectPage(capturedTab.pageId) end)
		end
	end
	updateTabSelection()
	return height
end

-- ============================================================ page rendering

-- Draw one vote slot's neutral and selected icons and register the shared state.
local function addVoteIcon(slot)
	local itemId, value, rect = slot.itemId, slot.value, slot.rect
	if type(itemId) ~= "string" or (value ~= "up" and value ~= "down") or type(rect) ~= "table" then return end
	local x = (tonumber(rect.x) or 0) * m_scale
	local y = (tonumber(rect.y) or 0) * m_scale
	local width = math.max(8, (tonumber(rect.width) or 0) * m_scale)
	local height = math.max(8, (tonumber(rect.height) or 0) * m_scale)

	local pixelSize = voteIconPixelSize()
	local neutralPath = m_assets[slot.neutralAssetId]
	local selectedPath = m_assets[slot.selectedAssetId]
	if not textureAvailable(neutralPath, pixelSize, pixelSize) then return end
	if not textureAvailable(selectedPath, pixelSize, pixelSize) then return end

	local iconSize = 20 * m_scale
	local iconX, iconY = x + (width - iconSize) / 2, y + (height - iconSize) / 2
	local neutral = addImage(Controls.PageContent, m_pageImages, neutralPath, iconX, iconY, iconSize, iconSize)
	local selected = addImage(Controls.PageContent, m_pageImages, selectedPath, iconX, iconY, iconSize, iconSize)
	if neutral == nil or selected == nil then return end
	local voted = getVote(itemId) == value
	neutral:SetHide(voted)
	selected:SetHide(not voted)

	local key = itemId .. "|" .. value
	m_voteHighlights[key] = m_voteHighlights[key] or {}
	m_voteHighlights[key][#m_voteHighlights[key] + 1] = { neutral = neutral, selected = selected }
end

-- Add one native vote hit rectangle for one action geometry rectangle.
local function addVoteHit(itemId, value, rect)
	if type(itemId) ~= "string" or (value ~= "up" and value ~= "down") then return end
	local instance = addHitRect("PageHitInstance", Controls.PageContent, rect, function() toggleVote(itemId, value) end)
	if instance == nil then return end
	instance.SelectedHL:SetHide(getVote(itemId) ~= value)

	local key = itemId .. "|" .. value
	m_voteHighlights[key] = m_voteHighlights[key] or {}
	m_voteHighlights[key][#m_voteHighlights[key] + 1] = { box = instance.SelectedHL }
end

-- Add one native text vote button for the fallback article footer.
local function addTextVote(parent, x, y, itemId, value)
	local instance = {}
	ContextPtr:BuildInstanceForControl("VoteButtonInstance", instance, parent)
	instance.Button:SetOffsetVal(x, y)
	instance.Button:SetSizeVal(104, 24)
	instance.SelectedHL:SetSizeVal(104, 24)
	instance.Label:SetTruncateWidth(92)
	instance.Label:SetText(localizedOr(value == "up" and "TXT_KEY_VD_NEWSPAPER_VOTE_UP" or "TXT_KEY_VD_NEWSPAPER_VOTE_DOWN", value == "up" and "Notable" or "Doubtful"))
	instance.Button:RegisterCallback(Mouse.eLClick, function() toggleVote(itemId, value) end)
	local key = itemId .. "|" .. value
	instance.SelectedHL:SetHide(getVote(itemId) ~= value)
	m_voteHighlights[key] = m_voteHighlights[key] or {}
	m_voteHighlights[key][#m_voteHighlights[key] + 1] = { box = instance.SelectedHL }
	return y + 30
end

-- Render the lead analysis evidence in the same order as the browser table.
local function renderTextEvidence(evidence, x, y, width)
	y = addTextBlock("DeckInstance", Controls.PageContent, x, y, width, evidence.title)
	y = addTextBlock("TextInstance", Controls.PageContent, x, y, width, evidence.description)
	y = addTextBlock("TextInstance", Controls.PageContent, x, y, width, table.concat(evidence.columns or {}, " | "))
	for _, row in ipairs(evidence.rows or {}) do
		local cells = { row.label }
		for _, value in ipairs(row.values or {}) do cells[#cells + 1] = value end
		y = addTextBlock("TextInstance", Controls.PageContent, x, y, width, table.concat(cells, " | "))
	end
	return addTextBlock("TextInstance", Controls.PageContent, x, y, width, evidence.note)
end

-- Draw the browser's visible story fields and return the next cursor.
local function renderTextItem(item, page, lead, x, y, width)
	local headline = inlineToText(item.headline)
	y = addTextBlock("HeadlineInstance", Controls.PageContent, x, y, width, headline)
	y = addTextBlock("DeckInstance", Controls.PageContent, x, y, width, inlineToText(item.deck))
	for _, block in ipairs(item.body or {}) do
		y = addTextBlock("TextInstance", Controls.PageContent, x, y, width, inlineToText(block)) + 4
	end
	if lead and page.layout == "analysis" and type(item.evidence) == "table" then
		y = renderTextEvidence(item.evidence, x, y, width)
	end
	local visible = { headline = item.headline, deck = item.deck, body = item.body }
	if type(item.history) == "table" then visible.history = { label = item.history.label, target = item.history.target } end
	y = addLinkRow(Controls.PageContent, x, y + 2, width, collectItemLinks(visible))
	y = addTextVote(Controls.PageContent, x, y, item.id, "up")
	y = addTextVote(Controls.PageContent, x + 110, y - 30, item.id, "down")
	return y + 8
end

-- Draw every item on the active page from structured issue data.
local function renderTextPage(page)
	local y = 12
	for index, itemId in ipairs(page.itemIds or {}) do
		local item = m_itemsById[itemId]
		if item ~= nil then
			y = renderTextItem(item, page, index == 1, PAGE_TEXT_LEFT, y, (m_contentWidth - 32))
			y = addRule(Controls.PageContent, PAGE_TEXT_LEFT, y, (m_contentWidth - 32))
		end
	end
	Controls.PageContent:SetSizeVal(m_contentWidth, math.max(1, y + 12))
end

-- Draw the active page from verified image strips and typed action rectangles.
local function renderTexturePage(page)
	local width = (tonumber(page.width) or m_contentWidth) * m_scale
	local height = math.max(1, (tonumber(page.height) or 0) * m_scale)
	Controls.PageContent:SetSizeVal(width, height)

	for _, strip in ipairs(page.strips or {}) do addStrip(Controls.PageContent, m_pageImages, strip) end

	for _, slot in ipairs(page.voteSlots or {}) do
		if type(slot) == "table" then addVoteIcon(slot) end
	end

	for _, geometry in ipairs(page.actions or {}) do
		local action = geometry.action
		if type(action) == "table" then
			if action.type == "vote" then
				for _, rect in ipairs(geometry.rects or {}) do addVoteHit(action.itemId, action.value, rect) end
			else
				for _, rect in ipairs(geometry.rects or {}) do
					addHitRect("PageHitInstance", Controls.PageContent, rect, function() dispatchAction(action) end)
				end
			end
		end
	end
end

-- Rebuild the active page and keep the requested scroll offset pending.
local function renderPage()
	clearContainer(Controls.PageContent, m_pageImages)
	m_pageImages = {}
	m_voteHighlights = {}

	local page = activePage()
	if page == nil then return end
	local rendered = m_renderPages[m_activePageId]
	if rendered ~= nil and stripsAvailable(rendered.strips) and voteIconsAvailable(rendered) then
		renderTexturePage(rendered)
	else
		renderTextPage(page)
	end
	Controls.PageScroll:CalculateInternalSize()
	m_scrollRestoreFrames = 2
end

-- Update footer page buttons and the page caption.
local function updateFooter()
	local index = m_pageIndexById[m_activePageId] or 1
	local page = activePage()
	local label = page ~= nil and (page.label or page.id) or ""
	Controls.PrevButton:SetHide(index <= 1)
	Controls.NextButton:SetHide(index >= #m_pages)
	Controls.PageLabel:SetText(localizedFormat("TXT_KEY_VD_NEWSPAPER_PAGE_OF", "Page %d of %d: %s", index, #m_pages, label))
end

-- Position and size the scroll viewport below the rendered header.
local function layoutPageScroll(headerHeight)
	local pageTop = HEADER_TOP + math.max(40, headerHeight) + 10
	local pageBottom = m_windowHeight - 64 - 6
	local viewportHeight = math.max(1, pageBottom - pageTop)
	Controls.PageScroll:SetOffsetVal(CONTENT_X, pageTop)
	Controls.PageScroll:SetSizeVal(m_contentWidth + 30, viewportHeight)
	Controls.PageBar:SetSizeY(math.max(60, viewportHeight - 42))
end

-- Fit the window and capture scale to the current game screen before rendering.
local function fitWindow()
	local ok, screenWidth, screenHeight = pcall(UIManager.GetScreenSizeVal, UIManager)
	if not ok then screenWidth, screenHeight = 1040, 760 end
	m_windowWidth = math.min(1000, math.max(1, screenWidth - 40))
	m_windowHeight = math.max(1, screenHeight - 40)
	m_contentWidth = math.max(1, m_windowWidth - 100)
	Controls.NewspaperGrid:SetSizeVal(m_windowWidth, m_windowHeight)
	Controls.Footer:SetSizeX(m_windowWidth)
	Controls.DetailOverlay:SetSizeVal(m_windowWidth, m_windowHeight)
	Controls.DetailScroll:SetSizeVal(m_windowWidth - 80, math.max(1, m_windowHeight - 104))
	Controls.DetailBar:SetSizeY(math.max(1, m_windowHeight - 146))
	local header = m_bundle.header or {}
	local regionWidth = tonumber(header.width) or m_contentWidth
	local headerHeight = tonumber(header.height) or 96
	local headerSpace = math.max(1, m_windowHeight - HEADER_TOP - 64 - PAGE_MIN_HEIGHT - 16)
	m_scale = math.min(1, m_contentWidth / regionWidth, headerSpace / headerHeight)
end

-- Rebuild the header, page, footer, and pending scroll from the fixture.
local function renderReader()
	fitWindow()
	local headerHeight = renderHeader()
	layoutPageScroll(headerHeight)
	renderPage()
	updateFooter()
	updateTabSelection()
	Controls.TitleLabel:SetText(publicationTitle())
end

-- ============================================================ page navigation

-- Switch pages after saving the old scroll offset and restore the new one.
selectPage = function(pageId)
	if pageId == nil or pageId == m_activePageId then return end
	if not hasPage(pageId) then return end
	saveScroll()
	m_activePageId = pageId
	renderPage()
	updateFooter()
	updateTabSelection()
	restoreScroll(pageId)
end

-- Move to the previous page when one exists.
local function previousPage()
	local index = m_pageIndexById[m_activePageId] or 1
	if index > 1 then selectPage(m_pages[index - 1].id) end
end

-- Move to the next page when one exists.
local function nextPage()
	local index = m_pageIndexById[m_activePageId] or 1
	if index < #m_pages then selectPage(m_pages[index + 1].id) end
end

-- ============================================================ show, hide, update

-- Apply one typed reader action from a page or header overlay.
dispatchAction = function(action)
	if type(action) ~= "table" then return end
	if action.type == "select-page" then
		selectPage(action.pageId)
	elseif action.type == "vote" then
		toggleVote(action.itemId, action.value)
	elseif action.type == "follow-link" then
		followLink(action.target)
	end
end

-- Open the fixture reader and rebuild it from the active page.
local function openReader()
	if m_readerOpen then return end
	if not loadFixture() then return end
	m_readerOpen = true
	m_detailOpen = false
	m_statusSeconds = 0
	Controls.StatusLabel:SetText("")
	Controls.DialogDim:SetHide(false)
	Controls.NewspaperGrid:SetHide(false)
	ContextPtr:SetHide(false)
	ContextPtr:SetUpdate(onUpdate)
	renderReader()
	restoreScroll(m_activePageId)
end

-- Hide the reader and release every displayed texture.
closeReader = function()
	if not m_readerOpen then return end
	saveScroll()
	m_readerOpen = false
	m_detailOpen = false
	Controls.DetailOverlay:SetHide(true)
	clearContainer(Controls.DetailContent, {})
	clearContainer(Controls.PageContent, m_pageImages)
	clearContainer(Controls.HeaderImage, m_headerImages)
	Controls.HeaderOverlay:DestroyAllChildren()
	Controls.HeaderTabs:DestroyAllChildren()
	m_pageImages = {}
	m_headerImages = {}
	m_voteHighlights = {}
	m_tabUnderlines = {}
	m_statusSeconds = 0
	Controls.StatusLabel:SetText("")
	Controls.DialogDim:SetHide(true)
	Controls.NewspaperGrid:SetHide(true)
	ContextPtr:SetHide(true)
	ContextPtr:ClearUpdate()
	if LuaEvents ~= nil and LuaEvents.VoxDeorumNewspaperClosed ~= nil then
		LuaEvents.VoxDeorumNewspaperClosed()
	end
end

-- Retire the status message and reapply scroll after late panel layout.
onUpdate = function(fDTime)
	if m_statusSeconds > 0 then
		m_statusSeconds = m_statusSeconds - (fDTime or 0)
		if m_statusSeconds <= 0 then Controls.StatusLabel:SetText("") end
	end
	if m_scrollRestoreFrames > 0 then
		m_scrollRestoreFrames = m_scrollRestoreFrames - 1
		restoreScroll(m_activePageId)
	end
	if not m_readerOpen then ContextPtr:ClearUpdate() end
end

-- Close the article overlay first, then the reader, without leaking Escape.
local function inputHandler(uiMsg, wParam)
	if uiMsg == KeyEvents.KeyDown and wParam == Keys.VK_ESCAPE then
		if m_detailOpen then
			closeArticle()
			return true
		end
		if m_readerOpen then
			closeReader()
			return true
		end
	end
	return false
end
ContextPtr:SetInputHandler(inputHandler)

-- ============================================================ wiring

Controls.CloseButton:RegisterCallback(Mouse.eLClick, closeReader)
Controls.DetailCloseButton:RegisterCallback(Mouse.eLClick, closeArticle)
Controls.PrevButton:RegisterCallback(Mouse.eLClick, previousPage)
Controls.NextButton:RegisterCallback(Mouse.eLClick, nextPage)
Controls.CloseLabel:SetText(localizedOr("TXT_KEY_VD_NEWSPAPER_CLOSE", "Close"))
Controls.DetailCloseLabel:SetText(localizedOr("TXT_KEY_VD_NEWSPAPER_CLOSE", "Close"))
Controls.PrevLabel:SetText(localizedOr("TXT_KEY_VD_NEWSPAPER_PREVIOUS", "Previous"))
Controls.NextLabel:SetText(localizedOr("TXT_KEY_VD_NEWSPAPER_NEXT", "Next"))

if LuaEvents ~= nil and LuaEvents.VoxDeorumNewspaperOpen ~= nil then
	LuaEvents.VoxDeorumNewspaperOpen.Add(openReader)
end

-- Fixture delivery is stage-scoped. The mock is the final include so a later
-- stage can replace only the fixture include with the live transport.
include("VoxDeorumNewspaperMock")
