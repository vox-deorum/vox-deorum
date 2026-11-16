-- Verify the real newspaper reader against deterministic native controls in Lua 5.1.
-- Run from the repository root with a Lua 5.1 interpreter: lua scripts/tests/newspaper-reader.lua

-- Exercise the configured internal reader zoom with a fresh native-control environment.
local function runAtZoom(zoom)
	-- Exercise actual newspaper UI Lua against a small deterministic engine substitute.
	local instances = {}
	local receiver = 2
	local pureObserver = false
	local callbacks = {}
	local registrationCount = 0
	local closedCount = 0
	local failTitle = nil
	local failLayout = false
	local failTextWrites = {}
	local measuredHeights = {}
	local screenWidth, screenHeight = 1100, 800
	local textureSupport = false
	local xmlFile = assert(io.open("civ5-mod/UI/Newspaper/VoxDeorumNewspaper.xml", "r"))
	local xmlSource = xmlFile:read("*a")
	xmlFile:close()
	local xmlControls = {}
	for tag in xmlSource:gmatch("<[^!?/][^>]*>") do
		local id = tag:match('ID="([^"]+)"')
		if id then xmlControls[id] = tag end
	end

	-- Build an event with the Add and callable conventions used by Civ V.
	local function event()
		local listeners = {}
		return setmetatable({ Add = function(fn) listeners[#listeners + 1] = fn end }, {
			__call = function(_, ...)
				for _, listener in ipairs(listeners) do listener(...) end
			end,
		})
	end

	-- Supply the native control methods used by the reader and retain their observable state.
	local function control(name)
		local tag = xmlControls[name] or ""
		local width, height = tag:match('Size="(%d+),(%d+)"')
		local x, y = tag:match('Offset="(%d+),(%d+)"')
		local result = { name = name, hidden = false, width = tonumber(width) or 100, height = tonumber(height) or 30,
			x = tonumber(x) or 0, y = tonumber(y) or 0, anchor = tag:match('Anchor="([^"]+)"'),
			color = tag:match('Color="([^"]+)"'), scroll = 0, text = "", children = {} }
		function result:SetHide(value) self.hidden = value end
		function result:SetText(value)
			local failure = failTextWrites[1]
			if failure and failure.control == name and failure.text == value then
				table.remove(failTextWrites, 1)
				error("injected native drawing failure")
			end
			if name == "HeaderTitle" and value == failTitle then failTitle = nil; error("injected native drawing failure") end
			self.text = value
		end
		function result:SetSizeVal(width, height)
			if name == "ScrollContent" and failLayout then failLayout = false; error("injected layout failure") end
			self.width, self.height = width, height
		end
		function result:SetOffsetVal(x, y) self.x, self.y = x, y end
		function result:SetTexture(path) self.texture = path end
		function result:SetTextureSizeVal(width, height) self.textureWidth, self.textureHeight = width, height end
		function result:SetTextureOffsetVal(x, y) self.textureX, self.textureY = x, y end
		function result:NormalizeTexture() self.normalized = true end
		function result:UnloadTexture() self.unloaded = true end
		function result:SetSizeX(width) self.width = width end
		function result:SetSizeY(height) self.height = height end
		-- Retain native wrapping constraints for header inset checks.
		function result:SetWrapWidth(width) self.wrapWidth = width end
		-- Supply controlled native label measurements without simulating font layout.
		function result:GetSizeY() return measuredHeights[name] or self.height end
		function result:SetScrollValue(value) self.scroll = value end
		function result:GetScrollValue() return self.scroll end
		function result:RegisterCallback(_, fn) self.callback = fn end
		function result:DestroyAllChildren() self.children = {} end
		-- Accept native layout methods whose effects are irrelevant to this contract test.
		return setmetatable(result, { __index = function() return function() end end })
	end

	Controls = setmetatable({}, { __index = function(self, key)
		local value = control(key)
		rawset(self, key, value)
		return value
	end })
	ContextPtr = control("ContextPtr")
	function ContextPtr:BuildInstanceForControl(name, instance, parent)
		setmetatable(instance, { __index = function(self, key)
			local value = control(key)
			rawset(self, key, value)
			return value
		end })
		instance.instanceName = name
		parent.children[#parent.children + 1] = instance
		instances[#instances + 1] = instance
	end
	function ContextPtr:SetUpdate(fn) self.update = fn end
	function ContextPtr:ClearUpdate() self.update = nil end
	function ContextPtr:SetInputHandler(fn) self.input = fn end
	Locale = { ConvertTextKey = function(key) return key end }
	UIManager = { GetScreenSizeVal = function() return screenWidth, screenHeight end }
	Mouse = { eLClick = 1 }
	KeyEvents = { KeyDown = 1 }
	Keys = { VK_ESCAPE = 27 }
	Game = { RegisterFunction = function(name, callback)
		registrationCount = registrationCount + 1
		callbacks[name] = callback
	end, IsNewspaperTextureAvailable = function(_, path) return textureSupport and path ~= "missing" end }
	VoxDeorumSeat = { EffectiveSeat = function() return receiver end, IsPureObserver = function() return pureObserver end }
	LuaEvents = { VoxDeorumNewspaperOpen = event(), VoxDeorumNewspaperRegister = event(), VoxDeorumNewspaperClosed = event() }
	LuaEvents.VoxDeorumNewspaperClosed.Add(function() closedCount = closedCount + 1 end)
	Events = { SequenceGameInitComplete = event(), LoadScreenClose = event(), GameplaySetActivePlayer = event() }

	-- Include the actual data adapter while retaining the supplied seat.
	function include(name)
		if name == "VoxDeorumNewspaperData" then dofile("civ5-mod/UI/Newspaper/VoxDeorumNewspaperData.lua") end
	end

	-- Construct a complete text-fallback delivery for two pages sharing one story.
	local function payload(id, title)
		local width = math.floor(math.min(screenWidth - 64, 1200 * zoom) / zoom * 64) / 64
		local body = {}
		for i = 1, 24 do body[i] = { { type = "text", text = "Paragraph " .. i } } end
		return {
			issue = { issueId = id, campaignId = "campaign", timelineId = "timeline", receiver = { playerId = receiver },
				publication = { title = title or id },
				items = { { id = "story", headline = { { type = "text", text = "Headline" } }, body = body } },
				pages = { { id = "first", label = "First", itemIds = { "story" } }, { id = "second", label = "Second", itemIds = { "story" } } } },
			bundle = { issueId = id, campaignId = "campaign", timelineId = "timeline", schemaVersion = 2, rendererVersion = "0.2.0", profile = { paperWidth = width, displayScale = zoom, textScale = 1, rasterScale = 2, maxTextureWidth = 4096, maxTextureHeight = 2048 },
				header = { width = width, height = 96, strips = {}, tabs = {}, actions = {} },
				pages = { { pageId = "first", width = width, height = 1000, strips = {}, actions = {}, voteSlots = {} },
					{ pageId = "second", width = width, height = 1000, strips = {}, actions = {}, voteSlots = {} } } },
			assets = {}, state = { activePageId = "first", scrollByPage = {}, votes = {} }, cacheRoot = "F:/cache",
		}
	end

	-- Locate an interactive instance in its current native parent.
	local function findInstance(parent, name, text)
		for _, instance in ipairs(parent.children) do
			if instance.instanceName == name and (text == nil or instance.Label.text == text) then return instance end
		end
		error("missing UI instance " .. name)
	end

	-- Check the reader's screen bounds and its backing independently of the active render mode.
	local function assertReaderBounds()
		local window = Controls.NewspaperGrid
		assert(window.anchor == "C,T", "reader positions are measured from the physical screen top")
		assert(window.y >= 32 and window.y + window.height <= screenHeight, "reader stays below the EUI top bar and above the screen bottom")
		local close = Controls.CloseButton
		assert(window.y + close.y >= 32 and close.y + close.height <= Controls.PageScroll.y, "Close stays below the native top bar and above the scrolling paper")
		assert(window.y + Controls.StatusLabel.y >= 32, "status messages stay below the native top bar")
		assert(Controls.PageScroll.y + Controls.PageScroll.height <= window.height, "publication viewport fits vertically inside the reader")
		assert(Controls.DetailOverlay.y + Controls.DetailOverlay.height <= window.height, "article overlay fits vertically inside the reader")
		assert(Controls.ScrollContent.height == Controls.PageContent.y + Controls.PageContent.height, "scroll extent includes the complete current header and page")
		if not Controls.HeaderTitle.hidden then
			local title, tabs = Controls.HeaderTitle, Controls.HeaderTabs
			assert(title.x > 0 and title.x == tabs.x, "native title and tabs share a left inset")
			assert(title.wrapWidth == Controls.ScrollContent.width - 2 * title.x, "native title wraps within equal side insets")
			assert(tabs.width == title.wrapWidth, "native tabs use the same inset width as the title")
			for _, tab in ipairs(tabs.children) do
				assert(tab.Button.x >= 0 and tab.Button.x + tab.Button.width <= tabs.width, "every native tab fits inside the header insets")
			end
		end
		local backing = Controls.PublicationBackground
		assert(backing.width == Controls.ScrollContent.width and backing.height == Controls.ScrollContent.height, "solid backing covers the complete scrolling publication")
		local red, green, blue, alpha = backing.color:match("(%d+),(%d+),(%d+),(%d+)")
		assert(tonumber(alpha) == 255 and tonumber(red) < 80 and tonumber(green) < 80 and tonumber(blue) < 80, "native beige text has an opaque dark backing")
	end

	-- Measure the current whole-publication scroll distance in native control units.
	local function scrollDistance()
		return Controls.PageScroll.scroll * math.max(0, Controls.ScrollContent.height - Controls.PageScroll.height)
	end

	-- Click a tab only when its complete hit area is visible in the publication viewport.
	local function clickVisibleTab(button, contentY)
		local top = contentY - scrollDistance()
		assert(top >= 0 and top + button.height <= Controls.PageScroll.height, "section tab must be visible before clicking")
		button.callback()
	end

	local sourceFile = assert(io.open("civ5-mod/UI/Newspaper/VoxDeorumNewspaper.lua", "r"))
	local readerSource = sourceFile:read("*a")
	sourceFile:close()
	readerSource = readerSource:gsub("local READER_ZOOM = 1", "local READER_ZOOM = " .. zoom, 1)
	assert(loadstring(readerSource, "VoxDeorumNewspaper.lua"))()
	assert(registrationCount == 0, "context load must never register with uninitialized DLL")
	assert(ContextPtr.hidden, "reader starts hidden")
	LuaEvents.VoxDeorumNewspaperRegister()
	assert(registrationCount == 2, "explicit DLL registration exposes both callbacks")
	local prepare, deliver = callbacks.VoxDeorumNewspaperPrepare, callbacks.VoxDeorumNewspaperDeliver
	assert(not prepare(42).success, "request IDs are explicit nonempty strings")
	pureObserver = true
	assert(not prepare("observer").success, "pure observer has no newspaper receiver")
	pureObserver = false
	local prepared = prepare("old")
	assert(prepared.success and prepared.receiver == receiver and prepared.requestId == "old")
	assert(prepared.view.width == 1036 and prepared.view.height == 708 and prepared.view.zoom == zoom, "prepare exposes physical publication space including its header")
	prepare("new")
	assert(not deliver("old", payload("old")).success, "superseded request cannot open")
	local invalid = payload("bad")
	invalid.issue.pages = { { id = "empty", itemIds = { "absent" } } }
	assert(not deliver("new", invalid).success and ContextPtr.hidden, "invalid first payload stays hidden")
	prepare("display")
	assert(deliver("display", payload("sample", "Valid publication")).success, "valid payload acknowledged")
	assert(not ContextPtr.hidden and not Controls.NewspaperGrid.hidden and Controls.HeaderTitle.text == "Valid publication")
	assertReaderBounds()
	assert(not deliver("display", payload("sample")).success, "successful request cannot replay")

	findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Button.callback()
	assert(not findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Underline.hidden, "page navigation works")
	findInstance(Controls.PageContent, "VoteButtonInstance").Button.callback()
	assert(not findInstance(Controls.PageContent, "VoteButtonInstance").SelectedHL.hidden, "vote is selected")
	Controls.PageScroll:SetScrollValue(0.6)
	prepare("repeat")
	assert(deliver("repeat", payload("sample", "Updated publication")).success, "already open reader accepts a delivery")
	assert(Controls.HeaderTitle.text == "Updated publication" and not findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Underline.hidden)
	assert(not findInstance(Controls.PageContent, "VoteButtonInstance").SelectedHL.hidden, "repeat preserves vote")
	assert(math.abs(Controls.PageScroll.scroll - 0.6) < 0.0001, "repeat preserves scroll")

	local children = Controls.PageContent.children
	prepare("malformed")
	invalid = payload("invalid")
	invalid.issue.items[1].body = "bad paragraphs"
	assert(not deliver("malformed", invalid).success)
	assert(Controls.HeaderTitle.text == "Updated publication" and children == Controls.PageContent.children, "validation leaves valid display untouched")
	prepare("badgeometry")
	invalid = payload("invalid")
	invalid.bundle.header.width = 0
	assert(not deliver("badgeometry", invalid).success and children == Controls.PageContent.children)

	prepare("moved")
	receiver = 3
	assert(not deliver("moved", payload("wrongseat")).success, "effective receiver change rejects late delivery")
	assert(Controls.HeaderTitle.text == "Updated publication")
	receiver = 2
	prepare("wrongreceiver")
	invalid = payload("wrongreceiver")
	invalid.issue.receiver.playerId = 7
	assert(not deliver("wrongreceiver", invalid).success, "payload receiver must match preparation")

	prepare("nativefailure")
	failTitle = "Broken publication"
	local failed = deliver("nativefailure", payload("broken", failTitle))
	assert(not failed.success and type(failed.error) == "string", "native drawing failure never acknowledges open")
	assert(not ContextPtr.hidden and Controls.HeaderTitle.text == "Updated publication", "failed render restores earlier valid display")
	assert(not findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Underline.hidden and not findInstance(Controls.PageContent, "VoteButtonInstance").SelectedHL.hidden)

	-- Failed candidate drawing followed by failed restoration must retain the prior publication's scroll.
	prepare("double-nativefailure")
	local shortCandidate = payload("double-broken", "Failed replacement")
	shortCandidate.issue.items[1].body = { { { type = "text", text = "Short replacement changes the scroll range." } } }
	failTextWrites = { { control = "HeaderTitle", text = "Failed replacement" },
		{ control = "HeaderTitle", text = "Updated publication" } }
	assert(not deliver("double-nativefailure", shortCandidate).success and ContextPtr.hidden and #failTextWrites == 0)
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(not ContextPtr.hidden and Controls.HeaderTitle.text == "Updated publication" and not findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Underline.hidden)
	assert(math.abs(Controls.PageScroll.scroll - 0.6) < 0.0001, "failed restoration cannot save partially rebuilt geometry over the cached scroll")

	prepare("newgame")
	Events.SequenceGameInitComplete()
	assert(not deliver("newgame", payload("newgame")).success, "new game invalidates prepared token")
	prepare("loadclose")
	Events.LoadScreenClose()
	assert(not deliver("loadclose", payload("loadclose")).success, "load activation invalidates prepared token")
	prepare("seat-event")
	receiver = 4
	Events.GameplaySetActivePlayer()
	receiver = 2
	assert(not deliver("seat-event", payload("seat-event")).success, "seat event invalidation survives switching back")

	Controls.CloseButton.callback()
	assert(ContextPtr.hidden)
	local beforeFailedClosed = closedCount
	prepare("closed-nativefailure")
	failTitle = "Failed while closed"
	local closedCandidate = payload("closed-broken", failTitle)
	closedCandidate.issue.items[1].body = { { { type = "text", text = "Short replacement changes scroll range" } } }
	assert(not deliver("closed-nativefailure", closedCandidate).success, "failed delivery while closed must fail")
	assert(ContextPtr.hidden and closedCount == beforeFailedClosed, "failed closed delivery must not emit a close event")
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(not ContextPtr.hidden and Controls.HeaderTitle.text == "Updated publication", "cached live delivery reopens without backend or generated fixture")
	assert(not findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Underline.hidden and not findInstance(Controls.PageContent, "VoteButtonInstance").SelectedHL.hidden)
	assert(math.abs(Controls.PageScroll.scroll - 0.6) < 0.0001, "cached callback reopen preserves scroll")
	receiver = 3
	Events.GameplaySetActivePlayer()
	assert(ContextPtr.hidden, "changing effective receiver closes the old receiver's newspaper")
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(ContextPtr.hidden, "another receiver cannot reopen cached publication")
	receiver = 2
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(not ContextPtr.hidden and not findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Underline.hidden, "returning original receiver can reopen cached publication")
	assert(not findInstance(Controls.PageContent, "VoteButtonInstance").SelectedHL.hidden and math.abs(Controls.PageScroll.scroll - 0.6) < 0.0001)
	receiver = 3
	ContextPtr.update(0.01)
	assert(ContextPtr.hidden, "observer override change without active-player event closes on update")
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(ContextPtr.hidden)
	receiver = 2
	LuaEvents.VoxDeorumNewspaperOpen()
	pureObserver = true
	ContextPtr.update(0.01)
	assert(ContextPtr.hidden, "pure observer cannot keep a previous receiver's publication visible")
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(ContextPtr.hidden, "pure observer cannot reopen cached publication")
	pureObserver = false
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(not ContextPtr.hidden and not findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Underline.hidden)
	assert(not findInstance(Controls.PageContent, "VoteButtonInstance").SelectedHL.hidden and math.abs(Controls.PageScroll.scroll - 0.6) < 0.0001)
	Controls.CloseButton.callback()
	prepare("reopen")
	assert(deliver("reopen", payload("sample", "Reopened publication")).success)
	assert(not findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Underline.hidden and not findInstance(Controls.PageContent, "VoteButtonInstance").SelectedHL.hidden)
	prepare("fresh")
	assert(deliver("fresh", payload("fresh")).success)
	assert(not findInstance(Controls.HeaderTabs, "TabButtonInstance", "First").Underline.hidden and findInstance(Controls.PageContent, "VoteButtonInstance").SelectedHL.hidden, "new issue resets state")

	-- Native section changes save the masthead position reached while returning to visible tabs.
	prepare("native-page-switch")
	local nativePages = payload("native-page-switch")
	local secondBody = {}
	for index = 1, 16 do secondBody[index] = { { type = "text", text = "Second section paragraph " .. index } } end
	nativePages.issue.items[2] = { id = "second-story", headline = { { type = "text", text = "Second story" } }, body = secondBody }
	nativePages.issue.pages[2].itemIds = { "second-story" }
	assert(deliver("native-page-switch", nativePages).success)
	local firstHeight = Controls.PageContent.height
	Controls.PageScroll:SetScrollValue(10 / (Controls.ScrollContent.height - Controls.PageScroll.height))
	local secondTab = findInstance(Controls.HeaderTabs, "TabButtonInstance", "Second").Button
	clickVisibleTab(secondTab, Controls.HeaderTabs.y + secondTab.y)
	assertReaderBounds()
	assert(Controls.PageContent.height < firstHeight and Controls.PageScroll.scroll == 0, "native section starts at its own top with a shorter extent")
	Controls.PageScroll:SetScrollValue(20 / (Controls.ScrollContent.height - Controls.PageScroll.height))
	local firstTab = findInstance(Controls.HeaderTabs, "TabButtonInstance", "First").Button
	clickVisibleTab(firstTab, Controls.HeaderTabs.y + firstTab.y)
	assertReaderBounds()
	assert(Controls.PageContent.height == firstHeight and math.abs(scrollDistance() - 10) < 0.0001, "returning to the first native section restores its extent and the masthead position saved at the tab click")
	clickVisibleTab(secondTab, Controls.HeaderTabs.y + secondTab.y)
	assertReaderBounds()
	assert(math.abs(scrollDistance() - 20) < 0.0001, "the second native section keeps the actual position saved at its tab click")
	print("PASS: newspaper Lua delivery, validation, visibility, failure recovery, state, lifecycle")

	-- Build padded strip textures for a responsive render delivery.
	local function renderedPayload(id, headerHeight)
		local result = payload(id)
		local width = result.bundle.profile.paperWidth
		local pixelWidth = math.ceil(width * 2 / 4) * 4
		-- Keep each source strip's CSS edges while padding its DDS dimensions to blocks.
		local function strip(name, y, height)
			result.assets[name] = id .. "/" .. name
			return { fileName = name, clip = { x = 0, y = y, width = width, height = height },
				pixelWidth = pixelWidth, pixelHeight = math.ceil(height * 2 / 4) * 4 }
		end
		result.bundle.header.height = headerHeight or 100.25
		result.bundle.header.strips = { strip("masthead", 0, result.bundle.header.height) }
		result.bundle.header.tabs = { { pageId = "first", rect = { x = 10.25, y = 65.5, width = 80.25, height = 26 } },
			{ pageId = "second", rect = { x = 100.5, y = 65.5, width = 80.25, height = 26 } } }
		local page = result.bundle.pages[1]
		page.height = 1000.5
		page.strips = { strip("top", 0, 333.25), strip("middle", 333.25, 333.25), strip("bottom", 666.5, 334) }
		local second = result.bundle.pages[2]
		second.height = 1400.5
		second.strips = { strip("secondTop", 0, 700.25), strip("secondBottom", 700.25, 700.25) }
		local voteRect = { x = 10.25, y = 20.25, width = 40.25, height = 40.25 }
		page.voteSlots = { { itemId = "story", value = "up", rect = voteRect,
			neutralAssetId = "neutral", selectedAssetId = "selected" } }
		page.actions = { { action = { type = "vote", itemId = "story", value = "up" }, rects = { voteRect } },
			{ action = { type = "follow-link", target = { type = "city", cityId = "0" } },
				rects = { { x = 100.25, y = 70.25, width = 28.5, height = 18.5 } } } }
		result.assets.neutral, result.assets.selected = id .. "/neutral", id .. "/selected"
		return result
	end

	-- Find the texture currently mounted in a native image region.
	local function findTexture(parent, path)
		for _, instance in ipairs(parent.children) do
			if instance.instanceName == "ImageInstance" and instance.Image.texture == path then return instance.Image end
		end
		error("missing texture " .. path)
	end

	-- Locate a rendered tab hit area in the fixture's publication order.
	local function renderedTab(index)
		for _, instance in ipairs(Controls.HeaderOverlay.children) do
			if instance.instanceName == "HeaderHitInstance" then
				index = index - 1
				if index == 0 then return instance end
			end
		end
		error("missing rendered tab")
	end

	textureSupport = true
	screenWidth, screenHeight = 800, 480
	prepare("rendered-page-switch")
	local renderedPages = renderedPayload("rendered-page-switch")
	renderedPages.state.scrollByPage.first = 20
	renderedPages.state.scrollByPage.second = 0
	assert(deliver("rendered-page-switch", renderedPages).success)
	assert(math.abs(scrollDistance() - Controls.PageContent.y - 20 * zoom) < 0.0001, "delivered positive numeric offsets measure CSS distance into the article page")
	local firstExtent = Controls.ScrollContent.height
	-- Return from the delivered article position to visible masthead tabs before switching.
	Controls.PageScroll:SetScrollValue(10 * zoom / (Controls.ScrollContent.height - Controls.PageScroll.height))
	local renderedSecondTab = renderedTab(2)
	clickVisibleTab(renderedSecondTab.Button, Controls.HeaderOverlay.y + renderedSecondTab.Box.y)
	assertReaderBounds()
	findTexture(Controls.PageContent, renderedPages.assets.secondTop)
	assert(Controls.ScrollContent.height > firstExtent and Controls.PageScroll.scroll == 0, "rendered tab opens the second section with its own extent and initial position")
	Controls.PageScroll:SetScrollValue(20 * zoom / (Controls.ScrollContent.height - Controls.PageScroll.height))
	local renderedFirstTab = renderedTab(1)
	clickVisibleTab(renderedFirstTab.Button, Controls.HeaderOverlay.y + renderedFirstTab.Box.y)
	assertReaderBounds()
	findTexture(Controls.PageContent, renderedPages.assets.top)
	assert(Controls.ScrollContent.height == firstExtent and math.abs(scrollDistance() - 10 * zoom) < 0.0001, "the first rendered section restores the masthead position saved after scrolling back to its tabs")
	clickVisibleTab(renderedSecondTab.Button, Controls.HeaderOverlay.y + renderedSecondTab.Box.y)
	assertReaderBounds()
	assert(math.abs(scrollDistance() - 20 * zoom) < 0.0001, "the second rendered section restores the actual position saved when its tab navigation occurred")

	for _, size in ipairs({ { 800, 600 }, { 1280, 720 }, { 1920, 1080 }, { 3840, 2160 } }) do
		screenWidth, screenHeight = size[1], size[2]
		local response = prepare("geometry")
		assert(response.view.width == screenWidth - 64 and response.view.height == screenHeight - 92)
		assert(response.view.zoom == zoom)
		local delivery = renderedPayload("geometry-" .. screenWidth)
		assert(deliver("geometry", delivery).success)
		assertReaderBounds()
		assert(not Controls.HeaderImage.hidden, "negotiated header uses textures without shrinking")
		assert(Controls.NewspaperGrid.width <= screenWidth - 40, "window respects physical screen width")
		assert(Controls.PageContent.width <= response.view.width and Controls.PageContent.width <= 1200 * zoom + 0.5)
		assert(Controls.PageContent.y == Controls.HeaderImage.y + Controls.HeaderImage.height, "header and article share an edge inside the scroll container")
		assert(Controls.ScrollContent.height == Controls.PageContent.y + Controls.PageContent.height, "scroll extent includes the complete masthead and article")
		assert(Controls.PageScroll.height == response.view.height, "the entire negotiated height is available for scrolling")
		local top = findTexture(Controls.PageContent, delivery.assets.top)
		local middle = findTexture(Controls.PageContent, delivery.assets.middle)
		local bottom = findTexture(Controls.PageContent, delivery.assets.bottom)
		assert(top.y + top.height == middle.y and middle.y + middle.height == bottom.y, "fractional CSS strip edges stay adjacent after native rounding")
		assert(bottom.y + bottom.height == Controls.PageContent.height, "scroll extent ends at the visible CSS edge")
		assert(bottom.textureHeight == 668 and bottom.normalized, "DDS block padding is cropped from the visible image")
		local vote = findInstance(Controls.PageContent, "PageHitInstance")
		assert(vote.Box.x == math.floor(10.25 * zoom + 0.5) and vote.Box.y == math.floor(20.25 * zoom + 0.5))
		assert(vote.Button.width == math.floor(50.5 * zoom + 0.5) - vote.Box.x, "vote hit target uses display zoom")
		assert(vote.HoverAnim.width == vote.Button.width and vote.SelectedHL.height == vote.Button.height)
		local icon = findTexture(Controls.PageContent, delivery.assets.selected)
		assert(icon.width == math.floor(20 * zoom + 0.5), "vote artwork uses the same zoom")
		assert(icon.textureWidth == 48 and icon.textureHeight == 48 and icon.normalized, "the full high-resolution vote icon is fitted to its display rectangle")
		vote.Button.callback()
		assert(not icon.hidden and not vote.SelectedHL.hidden)
		local follow = Controls.PageContent.children[#Controls.PageContent.children]
		assert(follow.Box.x == math.floor(100.25 * zoom + 0.5), "link geometry uses display zoom")
		follow.Button.callback()
		assert(Controls.StatusLabel.text ~= "", "scaled links still dispatch their native action")
		local expectedScroll = Controls.ScrollContent.height > Controls.PageScroll.height and 0.5 or 0
		Controls.PageScroll:SetScrollValue(expectedScroll)
		Controls.CloseButton.callback()
		assert(top.unloaded and icon.unloaded, "closing releases strip and vote textures")
		LuaEvents.VoxDeorumNewspaperOpen()
		assert(not Controls.HeaderImage.hidden and math.abs(Controls.PageScroll.scroll - expectedScroll) < 0.0001, "cached compatible delivery retains CSS scroll at its zoom")
	end

	-- A wider physical screen can change without invalidating an unchanged capped paper.
	Controls.CloseButton.callback()
	screenWidth = screenWidth - 100
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(not Controls.HeaderImage.hidden, "cached layout remains compatible when the physical width still exceeds its paper cap")

	-- Height and capped-width changes can reuse the same capture while native layout follows the window.
	prepare("late-height")
	local heightDelivery = renderedPayload("late-height")
	screenHeight = screenHeight - 50
	assert(deliver("late-height", heightDelivery).success and not Controls.HeaderImage.hidden, "height-only changes accept an in-flight capture at the same width and zoom")
	prepare("late-capped-width")
	local cappedDelivery = renderedPayload("late-capped-width")
	screenWidth = screenWidth - 100
	assert(deliver("late-capped-width", cappedDelivery).success and not Controls.HeaderImage.hidden, "equivalent capped widths accept an in-flight capture")
	local beforeResize = Controls.PageScroll.height
	screenHeight = screenHeight - 50
	ContextPtr.update(0.01)
	assert(not Controls.HeaderImage.hidden and Controls.PageScroll.height == beforeResize - 50, "height-only resize reuses images and adjusts the native viewport")
	Controls.CloseButton.callback()
	screenHeight = screenHeight - 50
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(not Controls.HeaderImage.hidden, "cached captures reopen at a different height when the header still fits")

	-- Reject late geometry before touching the currently displayed issue or controls.
	prepare("stale-view")
	local stale = renderedPayload("stale")
	local earlierChildren = Controls.PageContent.children
	local earlierTitle = Controls.HeaderTitle.text
	screenWidth = 600
	assert(not deliver("stale-view", stale).success, "screen changes invalidate an in-flight export")
	assert(earlierChildren == Controls.PageContent.children and earlierTitle == Controls.HeaderTitle.text)
	prepare("wrong-profile")
	local wrong = renderedPayload("wrong-profile")
	wrong.bundle.profile.paperWidth = wrong.bundle.profile.paperWidth - 1
	assert(not deliver("wrong-profile", wrong).success, "export width must match its prepared request")
	assert(earlierChildren == Controls.PageContent.children)
	prepare("wrong-region-width")
	wrong = renderedPayload("wrong-region-width")
	wrong.bundle.pages[1].width = wrong.bundle.pages[1].width + 1
	assert(not deliver("wrong-region-width", wrong).success, "page widths must agree with the profile's outer paper width")
	prepare("bad-strip")
	wrong = renderedPayload("bad-strip")
	wrong.bundle.pages[1].strips[1].clip.width = wrong.bundle.profile.paperWidth + 1
	assert(not deliver("bad-strip", wrong).success, "strip clipping cannot extend beyond the rendered paper")
	prepare("wrong-zoom")
	wrong = renderedPayload("wrong-zoom")
	wrong.bundle.profile.displayScale = zoom == 1 and 1.25 or 1
	assert(not deliver("wrong-zoom", wrong).success, "export zoom must match its prepared request")
	prepare("old-version")
	wrong = renderedPayload("old-version")
	wrong.bundle.schemaVersion, wrong.bundle.rendererVersion = 1, "0.1.0"
	assert(not deliver("old-version", wrong).success, "legacy captures cannot pass the current render contract")

	-- Cached captures use the native fallback until the game explicitly requests a new export.
	Controls.CloseButton.callback()
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(Controls.HeaderImage.hidden and not Controls.HeaderTitle.hidden, "cached publication reopens as native text after a view change")
	findInstance(Controls.PageContent, "VoteButtonInstance")
	local nativeChildren = Controls.PageContent.children
	screenHeight = screenHeight - 50
	ContextPtr.update(0.01)
	assert(Controls.HeaderImage.hidden and Controls.PageContent.children ~= nativeChildren, "open reader relayouts on a physical viewport change")
	prepare("refresh")
	assert(deliver("refresh", renderedPayload("refresh")).success and not Controls.HeaderImage.hidden, "explicit export restores textures for the changed view")

	-- A tall masthead scrolls away even when it fills the initial viewport.
	screenWidth, screenHeight = 1280, 480
	local view = prepare("tall-header").view
	local tall = renderedPayload("tall", (view.height + 80) / zoom)
	tall.bundle.profile.maxTextureHeight = 4096
	assert(deliver("tall-header", tall).success)
	assertReaderBounds()
	assert(not Controls.HeaderImage.hidden, "tall mastheads keep their rendered typography")
	assert(Controls.PageScroll.height == view.height and Controls.PageContent.y > view.height)
	local articleOffset = Controls.PageContent.y
	local range = Controls.ScrollContent.height - Controls.PageScroll.height
	Controls.PageScroll:SetScrollValue(articleOffset / range)
	Controls.CloseButton.callback()
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(math.abs(Controls.PageScroll.scroll * range - articleOffset) < 0.0001, "the masthead can scroll completely out of view and the position survives reopening")
	screenHeight = screenHeight - 50
	ContextPtr.update(0.01)
	assert(not Controls.HeaderImage.hidden and Controls.PageScroll.height == view.height - 50, "height changes preserve tall rendered publications")

	-- Texture failures retain the structured text and its native scroll coordinate space.
	prepare("missing-textures")
	local missing = renderedPayload("missing-textures")
	missing.assets.top = "missing"
	assert(deliver("missing-textures", missing).success)
	assert(not Controls.HeaderImage.hidden and Controls.HeaderTitle.hidden, "a valid masthead remains rendered above native page text")
	assert(Controls.PageContent.y == math.floor(missing.bundle.header.height * zoom + 0.5), "native page starts immediately below the rendered masthead")
	assert(Controls.ScrollContent.height == Controls.PageContent.y + Controls.PageContent.height, "mixed mode scroll extent contains its complete header and native page")
	assertReaderBounds()
	findInstance(Controls.PageContent, "VoteButtonInstance")
	Controls.PageScroll:SetScrollValue(0.4)
	Controls.CloseButton.callback()
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(math.abs(Controls.PageScroll.scroll - 0.4) < 0.0001, "native page fallback preserves scroll without applying export zoom")

	-- Return the whole-publication offset for each controlled reading position.
	local function readingDistance(location, headerHeight)
		return location == "top" and 0 or location == "masthead" and headerHeight / 2 or headerHeight + 120
	end

	-- Header mode changes preserve the article position or proportional masthead progress.
	for _, location in ipairs({ "top", "masthead", "article" }) do
		screenWidth, screenHeight = 800, 600
		local id = "header-position-" .. location
		prepare(id)
		local mixed = renderedPayload(id, 250 / zoom)
		mixed.assets.top = "missing"
		assert(deliver(id, mixed).success)
		local originalHeader = Controls.PageContent.y
		local originalDistance = readingDistance(location, originalHeader)
		Controls.PageScroll:SetScrollValue(originalDistance / (Controls.ScrollContent.height - Controls.PageScroll.height))
		screenWidth = 360
		ContextPtr.update(0.01)
		assert(Controls.HeaderImage.hidden and not Controls.HeaderTitle.hidden, "a narrower view replaces the rendered masthead with native title and tabs")
		local nativeHeader = Controls.PageContent.y
		assert(nativeHeader < originalHeader, "the regression exercises a changed masthead height")
		local expectedDistance = readingDistance(location, nativeHeader)
		assert(math.abs(scrollDistance() - expectedDistance) < 0.0001, "header fallback preserves the current masthead or article reading point")
		assertReaderBounds()
		Controls.CloseButton.callback()
		LuaEvents.VoxDeorumNewspaperOpen()
		assert(math.abs(scrollDistance() - expectedDistance) < 0.0001, "reopening retains the position after a header mode change")
		screenWidth = 800
		ContextPtr.update(0.01)
		assert(not Controls.HeaderImage.hidden and math.abs(scrollDistance() - originalDistance) < 0.0001, "restoring the image masthead preserves the same reading point")
		Controls.CloseButton.callback()
		screenWidth = 360
		LuaEvents.VoxDeorumNewspaperOpen()
		assert(Controls.HeaderImage.hidden and math.abs(scrollDistance() - expectedDistance) < 0.0001, "a header change while closed also preserves the reading point on reopen")
	end

	-- A native masthead and zoomed raster page share one reading position as header textures return or disappear.
	for _, location in ipairs({ "top", "masthead", "article" }) do
		screenWidth, screenHeight = 800, 400
		local id = "native-masthead-" .. location
		prepare(id)
		local mixed = renderedPayload(id, 250 / zoom)
		local mastheadPath = mixed.assets.masthead
		mixed.assets.masthead = "missing"
		assert(deliver(id, mixed).success and Controls.HeaderImage.hidden)
		findTexture(Controls.PageContent, mixed.assets.top)
		assertReaderBounds()
		local nativeDistance = readingDistance(location, Controls.PageContent.y)
		Controls.PageScroll:SetScrollValue(nativeDistance / (Controls.ScrollContent.height - Controls.PageScroll.height))
		Controls.CloseButton.callback()
		mixed.assets.masthead = mastheadPath
		LuaEvents.VoxDeorumNewspaperOpen()
		assert(not Controls.HeaderImage.hidden and math.abs(scrollDistance() - readingDistance(location, Controls.PageContent.y)) < 0.0001,
			"restoring masthead textures preserves header progress or article distance above a zoomed rendered page")
		findTexture(Controls.PageContent, mixed.assets.top)
		Controls.CloseButton.callback()
		mixed.assets.masthead = "missing"
		LuaEvents.VoxDeorumNewspaperOpen()
		assert(Controls.HeaderImage.hidden and math.abs(scrollDistance() - nativeDistance) < 0.0001,
			"reopening with a native masthead restores the same reading point while the page stays rendered")
		findTexture(Controls.PageContent, mixed.assets.top)
	end

	-- Incomplete captured navigation uses native tabs while retaining raster pages.
	for _, tabCount in ipairs({ 0, 1 }) do
		screenWidth, screenHeight = 800, 480
		local id = "incomplete-tabs-" .. tabCount
		prepare(id)
		local partial = renderedPayload(id)
		while #partial.bundle.header.tabs > tabCount do table.remove(partial.bundle.header.tabs) end
		assert(deliver(id, partial).success, "incomplete header navigation remains a readable delivery")
		assert(Controls.HeaderImage.hidden and not Controls.HeaderTitle.hidden and not Controls.HeaderTabs.hidden,
			"missing captured section tabs select the complete native masthead")
		for index, page in ipairs(partial.issue.pages) do
			Controls.PageScroll:SetScrollValue(0)
			local tab = findInstance(Controls.HeaderTabs, "TabButtonInstance", page.label)
			clickVisibleTab(tab.Button, Controls.HeaderTabs.y + tab.Button.y)
			assert(not tab.Underline.hidden, "every issue section remains selectable after masthead fallback")
			findTexture(Controls.PageContent, index == 1 and partial.assets.top or partial.assets.secondTop)
			assertReaderBounds()
		end
	end

	-- Alternate supported capture profiles remain readable at the negotiated paper size.
	prepare("raster-one")
	local alternate = renderedPayload("raster-one")
	alternate.bundle.profile.rasterScale = 1
	alternate.bundle.profile.textScale = 1.25
	alternate.bundle.profile.maxTextureWidth, alternate.bundle.profile.maxTextureHeight = 2048, 1024
	for _, region in ipairs({ alternate.bundle.header, alternate.bundle.pages[1], alternate.bundle.pages[2] }) do
		for _, strip in ipairs(region.strips) do
			strip.pixelWidth = math.ceil(strip.clip.width / 4) * 4
			strip.pixelHeight = math.ceil(strip.clip.height / 4) * 4
		end
	end
	assert(deliver("raster-one", alternate).success and not Controls.HeaderImage.hidden)

	-- ArduinoJson can parse decimal 1.2 one binary step above the Lua setting.
	if zoom == 1.2 then
		prepare("parsed-decimal-zoom")
		local parsed = renderedPayload("parsed-decimal-zoom")
		parsed.bundle.profile.displayScale = 1.2000000000000002
		assert(deliver("parsed-decimal-zoom", parsed).success and not Controls.HeaderImage.hidden, "JSON floating-point drift preserves the negotiated decimal zoom")

		-- Each page remembers independent rendered and native locations across live mode changes.
		screenWidth, screenHeight = 1280, 720
		prepare("mode-scroll")
		assert(deliver("mode-scroll", renderedPayload("mode-scroll")).success)
		Controls.PageScroll:SetScrollValue(0.45)
		screenWidth = 900
		ContextPtr.update(0.01)
		assert(Controls.HeaderImage.hidden and Controls.PageScroll.scroll == 0, "first native display starts at its own top")
		Controls.PageScroll:SetScrollValue(0.7)
		screenWidth = 1280
		ContextPtr.update(0.01)
		assert(not Controls.HeaderImage.hidden and math.abs(Controls.PageScroll.scroll - 0.45) < 0.0001, "returning to the capture restores its previous CSS location")
		screenWidth = 900
		ContextPtr.update(0.01)
		assert(Controls.HeaderImage.hidden and math.abs(Controls.PageScroll.scroll - 0.7) < 0.0001, "returning to native text restores its independent location")
		screenWidth = 1280
		ContextPtr.update(0.01)
		assert(not Controls.HeaderImage.hidden and math.abs(Controls.PageScroll.scroll - 0.45) < 0.0001)
	end

	-- Failed live native relayout closes partial controls without replacing the cached issue or scroll.
	screenWidth, screenHeight = 800, 600
	prepare("resize-failure")
	local resizeDelivery = renderedPayload("resize-failure")
	assert(deliver("resize-failure", resizeDelivery).success)
	Controls.PageScroll:SetScrollValue(0.35)
	local savedDistance = 0.35 * (Controls.ScrollContent.height - Controls.PageScroll.height)
	local beforeFailure = #instances
	local priorHeader = findTexture(Controls.HeaderImage, resizeDelivery.assets.masthead)
	local priorPage = findTexture(Controls.PageContent, resizeDelivery.assets.top)
	local closedBeforeResize = closedCount
	failLayout = true
	screenHeight = screenHeight - 1
	ContextPtr.update(0.01)
	assert(ContextPtr.hidden and Controls.NewspaperGrid.hidden and rawget(ContextPtr, "update") == nil, "a native failure during resize closes the reader safely")
	assert(closedCount == closedBeforeResize + 1 and #Controls.PageContent.children == 0 and #Controls.HeaderImage.children == 0)
	assert(priorHeader.unloaded and priorPage.unloaded, "resize releases the former textures before rebuilding")
	for index = beforeFailure + 1, #instances do
		local instance = instances[index]
		if instance.instanceName == "ImageInstance" then assert(instance.Image.unloaded, "failure cleanup releases partially rebuilt textures") end
	end
	LuaEvents.VoxDeorumNewspaperOpen()
	assert(not ContextPtr.hidden and not Controls.HeaderImage.hidden, "cached publication reopens after resize recovery")
	findTexture(Controls.HeaderImage, resizeDelivery.assets.masthead)
	findTexture(Controls.PageContent, resizeDelivery.assets.top)
	assertReaderBounds()
	local restoredDistance = Controls.PageScroll.scroll * (Controls.ScrollContent.height - Controls.PageScroll.height)
	assert(math.abs(restoredDistance - savedDistance) < 0.0001, "failed relayout cannot overwrite the last valid CSS scroll offset")

	-- Physical screen fractions cannot round the displayed paper beyond its available width.
	screenWidth, screenHeight = 800.75, 600.75
	local fractional = prepare("fractional-screen")
	assert(fractional.view.width == 736 and fractional.view.height == 508)
	local candidate = renderedPayload("fractional-screen")
	candidate.bundle.profile.paperWidth = VoxDeorumNewspaperData.PaperWidth(fractional.view)
	-- Use text regions to isolate the physical geometry from synthetic strip textures.
	candidate.bundle.header.width, candidate.bundle.header.strips = candidate.bundle.profile.paperWidth, {}
	for _, page in ipairs(candidate.bundle.pages) do page.width, page.strips = candidate.bundle.profile.paperWidth, {} end
	assert(deliver("fractional-screen", candidate).success)
	assert(Controls.NewspaperGrid.width <= screenWidth - 40)

	-- Native fallback keeps every section reachable when tabs wrap on a narrow paper.
	screenWidth, screenHeight = 360, 600
	prepare("wrapped-tabs")
	local sections = payload("wrapped-tabs")
	sections.issue.publication.title = "An extended publication title for a narrow multi-line native masthead"
	measuredHeights.HeaderTitle = 132
	for index = 3, 8 do
		local id = "section-" .. index
		sections.issue.pages[index] = { id = id, label = "Section " .. index, itemIds = { "story" } }
		sections.bundle.pages[index] = { pageId = id, width = sections.bundle.profile.paperWidth,
			height = 1000, strips = {}, actions = {}, voteSlots = {} }
	end
	assert(deliver("wrapped-tabs", sections).success)
	assertReaderBounds()
	assert(Controls.HeaderTitle.y + Controls.HeaderTitle:GetSizeY() <= Controls.HeaderTabs.y, "native tabs start below the full measured height of a wrapped title")
	assert(Controls.HeaderTabs.height > 26, "section navigation wraps into multiple rows")
	for _, tab in ipairs(Controls.HeaderTabs.children) do
		assert(tab.Button.x >= 0 and tab.Button.x + tab.Button.width <= Controls.HeaderTabs.width)
		assert(tab.Button.y + tab.Button.height <= Controls.HeaderTabs.height)
		tab.Button.callback()
		assert(not tab.Underline.hidden, "every wrapped section remains selectable")
	end
	assert(Controls.PageContent.y >= Controls.HeaderTabs.y + Controls.HeaderTabs.height)
	measuredHeights.HeaderTitle = nil

	-- The shared close button and Escape dismiss detail before the publication.
	screenWidth, screenHeight = 800, 600
	prepare("article-close")
	local article = renderedPayload("article-close")
	article.bundle.pages[1].actions[2].action.target = { type = "article", itemId = "story" }
	assert(deliver("article-close", article).success)
	local articleLink = Controls.PageContent.children[#Controls.PageContent.children]
	Controls.PageScroll:SetScrollValue(0.3)
	articleLink.Button.callback()
	assert(not Controls.DetailOverlay.hidden)
	assert(Controls.DetailContent.width <= Controls.DetailScroll.width, "article detail fits its scroll viewport")
	for _, block in ipairs(Controls.DetailContent.children) do
		if block.instanceName == "TextInstance" then
			assert(block.Box.x + block.Box.width <= Controls.DetailContent.width, "detail prose stays inside the viewport")
		end
	end
	Controls.CloseButton.callback()
	assert(Controls.DetailOverlay.hidden and not ContextPtr.hidden and Controls.PageScroll.scroll == 0.3,
		"Close returns from detail to the same publication position")
	articleLink.Button.callback()
	assert(ContextPtr.input(KeyEvents.KeyDown, Keys.VK_ESCAPE))
	assert(Controls.DetailOverlay.hidden and not ContextPtr.hidden, "Escape returns from detail")
	assert(ContextPtr.input(KeyEvents.KeyDown, Keys.VK_ESCAPE) and ContextPtr.hidden, "Escape then closes the publication")

	-- Resizing dismisses stale detail geometry and reopening wraps to the new viewport.
	screenWidth, screenHeight = 1280, 600
	prepare("article-resize")
	local resizingArticle = payload("article-resize")
	resizingArticle.issue.items[1].body[1][2] = { type = "link", text = "Related report", target = { type = "article", itemId = "story" } }
	assert(deliver("article-resize", resizingArticle).success)
	local nativeArticleLink = findInstance(Controls.PageContent, "LinkButtonInstance").Button
	Controls.PageScroll:SetScrollValue(1)
	local articlePosition = scrollDistance()
	local linkTop = Controls.PageContent.y + nativeArticleLink.y - articlePosition
	assert(linkTop >= 0 and linkTop + nativeArticleLink.height <= Controls.PageScroll.height, "the article link is visible before opening detail")
	nativeArticleLink.callback()
	assert(not Controls.DetailOverlay.hidden)
	assert(Controls.DetailScroll.y == 64, "a short detail headline retains the minimum article viewport top")
	local wideDetailWidth = Controls.DetailContent.width
	screenWidth = 360
	ContextPtr.update(0.01)
	assert(not ContextPtr.hidden and Controls.DetailOverlay.hidden and #Controls.DetailContent.children == 0, "live resize returns to the publication and clears stale article controls")
	assert(math.abs(scrollDistance() - articlePosition) < 0.0001, "closing detail on resize preserves the underlying native reading position")
	nativeArticleLink = findInstance(Controls.PageContent, "LinkButtonInstance").Button
	linkTop = Controls.PageContent.y + nativeArticleLink.y - scrollDistance()
	assert(linkTop >= 0 and linkTop + nativeArticleLink.height <= Controls.PageScroll.height, "the rebuilt article link remains visible")
	measuredHeights.DetailTitle = 96
	nativeArticleLink.callback()
	assert(not Controls.DetailOverlay.hidden and Controls.DetailContent.width < wideDetailWidth, "reopening detail uses the resized viewport")
	assert(Controls.DetailContent.width <= Controls.DetailScroll.width)
	assert(Controls.DetailScroll.y >= Controls.DetailTitle.y + Controls.DetailTitle:GetSizeY() + 8,
		"article paragraphs begin below the full measured wrapped headline")
	assert(Controls.DetailScroll.y + Controls.DetailScroll.height <= Controls.DetailOverlay.height,
		"the article viewport fits vertically below its wrapped headline")
	assert(Controls.DetailBar.height > 0 and Controls.DetailBar.height <= Controls.DetailScroll.height,
		"the detail scrollbar fits the shortened article viewport")
	for _, block in ipairs(Controls.DetailContent.children) do
		if block.instanceName == "TextInstance" then
			assert(block.Box.x + block.Box.width <= Controls.DetailScroll.width and block.Text.wrapWidth == block.Box.width,
				"reopened detail wraps every paragraph within the narrower scroll viewport")
		end
	end
	Controls.CloseButton.callback()
	measuredHeights.DetailTitle = nil
	Controls.CloseButton.callback()

	print("PASS: responsive newspaper negotiation, shared edges, zoom, stale views, cached fallback at zoom " .. zoom)
end

for _, zoom in ipairs({ 0.5, 1, 1.2, 1.25, 2 }) do runAtZoom(zoom) end
