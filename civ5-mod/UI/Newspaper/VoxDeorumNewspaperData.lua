-- Pure publication indexing and text adapters for Vox Deorum newspaper viewers.

VoxDeorumNewspaperData = VoxDeorumNewspaperData or {}

-- Return whether a value is a finite number, optionally greater than zero.
local function finiteNumber(value, positive)
	return type(value) == "number" and value == value and value > -math.huge and value < math.huge
		and (not positive or value > 0)
end

-- Return whether an optional array contains only values accepted by its validator.
local function validArray(values, validate, required)
	if values == nil then return not required end
	if type(values) ~= "table" or (required and #values == 0) then return false end
	for _, value in ipairs(values) do
		if not validate(value) then return false end
	end
	return true
end

-- Return whether a value is nonempty text.
local function nonemptyText(value)
	return type(value) == "string" and value ~= ""
end

-- Return whether a value is a text table cell, including intentionally empty cells.
local function tableCell(value)
	return type(value) == "string"
end

-- Return whether an inline run can be rendered by the native text fallback.
local function validInline(nodes)
	-- Check the text and optional destination of one inline node.
	local function validNode(node)
		return type(node) == "table" and (node.type == "break" or type(node.text) == "string")
			and (node.target == nil or type(node.target) == "table")
	end
	return validArray(nodes, validNode, false)
end

-- Return whether an optional analysis table can be rendered without coercing its cells.
local function validEvidence(evidence)
	if evidence == nil then return true end
	if type(evidence) ~= "table" then return false end
	-- Check the cell types consumed by table.concat in the fallback renderer.
	local function validRow(row)
		return type(row) == "table" and type(row.label) == "string"
			and validArray(row.values, tableCell, false)
	end
	return validArray(evidence.columns, nonemptyText, false) and validArray(evidence.rows, validRow, false)
end

-- Return whether a rectangle has finite coordinates and positive dimensions.
local function validRect(rect)
	return type(rect) == "table" and finiteNumber(rect.x) and finiteNumber(rect.y)
		and rect.x >= 0 and rect.y >= 0
		and finiteNumber(rect.width, true) and finiteNumber(rect.height, true)
end

-- Return the browser paper width negotiated from physical space and reader zoom.
-- Keep this formula aligned with computeRenderProfileForView in vox-agents/src/newspaper/renderer/layout.ts.
function VoxDeorumNewspaperData.PaperWidth(view)
	return math.floor(math.min(view.width, 1200 * view.zoom) / view.zoom * 64) / 64
end

-- Return whether two requests describe the same physical publication space and zoom.
function VoxDeorumNewspaperData.SameView(first, second)
	return type(first) == "table" and type(second) == "table" and first.width == second.width
		and first.height == second.height and first.zoom == second.zoom
end

-- Return whether the bundle was rendered at the width and zoom requested by the game.
function VoxDeorumNewspaperData.ProfileMatchesView(profile, view)
	return type(profile) == "table" and type(view) == "table"
		and profile.paperWidth == VoxDeorumNewspaperData.PaperWidth(view)
		-- The DLL's JSON parser can shift decimal zoom by a tiny binary fraction.
		and finiteNumber(profile.displayScale, true) and math.abs(profile.displayScale - view.zoom) <= 1e-9
end

-- Return whether a bundle region contains safe geometry and optional interaction arrays.
local function validRegion(region, profile)
	if type(region) ~= "table" or not finiteNumber(region.width, true) or not finiteNumber(region.height, true) then return false end
	if region.width ~= profile.paperWidth then return false end
	-- Check the strip fields consumed by texture safety and cropping.
	local function validStrip(strip)
		return type(strip) == "table" and nonemptyText(strip.fileName) and validRect(strip.clip)
			and finiteNumber(strip.pixelWidth, true) and finiteNumber(strip.pixelHeight, true)
			and strip.pixelWidth % 4 == 0 and strip.pixelHeight % 4 == 0
			and strip.pixelWidth <= profile.maxTextureWidth and strip.pixelHeight <= profile.maxTextureHeight
			and strip.clip.x + strip.clip.width <= region.width and strip.clip.y + strip.clip.height <= region.height
			and strip.clip.width * profile.rasterScale <= strip.pixelWidth
			and strip.clip.height * profile.rasterScale <= strip.pixelHeight
	end
	-- Check each typed action's native hit rectangles.
	local function validAction(geometry)
		return type(geometry) == "table" and type(geometry.action) == "table"
			and validArray(geometry.rects, validRect, false)
	end
	-- Check each dynamic vote icon and its native hit rectangle.
	local function validVote(slot)
		return type(slot) == "table" and nonemptyText(slot.itemId) and validRect(slot.rect)
			and nonemptyText(slot.neutralAssetId) and nonemptyText(slot.selectedAssetId)
			and (slot.value == "up" or slot.value == "down")
	end
	-- Check each header tab before the renderer reads its page and rectangle.
	local function validTab(tab)
		return type(tab) == "table" and nonemptyText(tab.pageId) and validRect(tab.rect)
	end
	return validArray(region.strips, validStrip, false) and validArray(region.actions, validAction, false)
		and validArray(region.voteSlots, validVote, false) and validArray(region.tabs, validTab, false)
end

-- Validate and index a delivery before any valid reader data or controls are replaced.
function VoxDeorumNewspaperData.ValidateFixture(fixture)
	if type(fixture) ~= "table" or type(fixture.issue) ~= "table" or type(fixture.bundle) ~= "table" then
		return nil, "Newspaper delivery needs an issue and render bundle."
	end
	local issue, bundle = fixture.issue, fixture.bundle
	if not nonemptyText(issue.issueId) or not nonemptyText(issue.campaignId) or not nonemptyText(issue.timelineId)
		or bundle.issueId ~= issue.issueId or bundle.campaignId ~= issue.campaignId or bundle.timelineId ~= issue.timelineId then
		return nil, "Newspaper issue and bundle identities do not match."
	end
	if type(issue.receiver) ~= "table" or not finiteNumber(issue.receiver.playerId)
		or issue.receiver.playerId < 0 or issue.receiver.playerId % 1 ~= 0 then
		return nil, "Newspaper delivery has no valid receiving player."
	end
	local itemIds, pageIds = {}, {}
	-- Validate every story field that the native fallback or article overlay traverses.
	local function validItem(item)
		if type(item) ~= "table" or not nonemptyText(item.id) or itemIds[item.id] then return false end
		itemIds[item.id] = true
		local earlier = item.earlierReport
		if earlier ~= nil and (type(earlier) ~= "table" or type(earlier.target) ~= "table"
			or not validArray(earlier.summary, validInline, false)) then return false end
		return type(item.headline) == "table" and #item.headline > 0 and validInline(item.headline)
			and validInline(item.subheadline) and validInline(item.sourceNote)
			and validArray(item.body, validInline, true) and validEvidence(item.evidenceTable)
	end
	-- Reject duplicate pages and item references that would display an empty or ambiguous issue.
	local function validPage(page)
		if type(page) ~= "table" or not nonemptyText(page.id) or pageIds[page.id]
			or (page.label ~= nil and type(page.label) ~= "string") then return false end
		pageIds[page.id] = true
		local selected = {}
		-- Require each page item to exist exactly once on this page.
		local function validItemId(itemId)
			if not nonemptyText(itemId) or not itemIds[itemId] or selected[itemId] then return false end
			selected[itemId] = true
			return true
		end
		return validArray(page.itemIds, validItemId, true)
	end
	if not validArray(issue.items, validItem, true) or not validArray(issue.pages, validPage, true) then
		return nil, "Newspaper delivery contains invalid stories or page references."
	end
	-- Keep render geometry aligned with the indexed publication pages.
	local function validRenderPage(page)
		return validRegion(page, bundle.profile) and pageIds[page.pageId] == true
	end
	local profile = bundle.profile
	if bundle.schemaVersion ~= 2 or bundle.rendererVersion ~= "0.2.0" or type(profile) ~= "table"
		or not finiteNumber(profile.paperWidth, true) or profile.paperWidth > 1200
		or not finiteNumber(profile.displayScale, true) or profile.displayScale < 0.5 or profile.displayScale > 2
		or not finiteNumber(profile.textScale, true) or profile.textScale > 3
		or (profile.rasterScale ~= 1 and profile.rasterScale ~= 2)
		or not finiteNumber(profile.maxTextureWidth, true) or profile.maxTextureWidth % 1 ~= 0 or profile.maxTextureWidth > 4096
		or not finiteNumber(profile.maxTextureHeight, true) or profile.maxTextureHeight % 1 ~= 0 or profile.maxTextureHeight > 4096
		or not validRegion(bundle.header, profile) or not validArray(bundle.pages, validRenderPage, true) then
		return nil, "Newspaper delivery contains invalid render geometry."
	end
	if fixture.assets ~= nil and type(fixture.assets) ~= "table" then return nil, "Invalid newspaper assets." end
	if fixture.cacheRoot ~= nil and type(fixture.cacheRoot) ~= "string" then return nil, "Invalid newspaper cache root." end
	if fixture.state ~= nil then
		if type(fixture.state) ~= "table" or (fixture.state.votes ~= nil and type(fixture.state.votes) ~= "table")
			or (fixture.state.scrollByPage ~= nil and type(fixture.state.scrollByPage) ~= "table") then
			return nil, "Invalid newspaper reader state."
		end
	end
	return VoxDeorumNewspaperData.IndexIssue(issue, bundle)
end

-- Index issue content and rendered pages by their publication identifiers.
function VoxDeorumNewspaperData.IndexIssue(issue, bundle)
	local result = { itemsById = {}, pages = {}, pageById = {}, pageIndexById = {}, renderPages = {} }
	for _, page in ipairs(bundle.pages or {}) do
		if type(page) == "table" and type(page.pageId) == "string" then result.renderPages[page.pageId] = page end
	end
	for _, item in ipairs(issue.items or {}) do
		if type(item) == "table" and type(item.id) == "string" then result.itemsById[item.id] = item end
	end
	for _, page in ipairs(issue.pages or {}) do
		if type(page) == "table" and type(page.id) == "string" then
			result.pages[#result.pages + 1] = page
			result.pageById[page.id] = page
			result.pageIndexById[page.id] = #result.pages
		end
	end
	return result
end

-- Turn inline nodes into plain text for a native Label.
function VoxDeorumNewspaperData.InlineToText(nodes)
	if type(nodes) ~= "table" then return "" end
	local parts = {}
	for _, node in ipairs(nodes) do
		if type(node) == "table" then
			if node.type == "break" then
				parts[#parts + 1] = "\n"
			elseif type(node.text) == "string" then
				parts[#parts + 1] = node.text
			end
		end
	end
	return table.concat(parts)
end

-- Collect typed links from one item's headline, subheadline, body, sourceNote, and earlierReport.
function VoxDeorumNewspaperData.CollectItemLinks(item)
	local links = {}
	-- Collect the links from one inline block.
	local function scan(nodes)
		if type(nodes) ~= "table" then return end
		for _, node in ipairs(nodes) do
			if type(node) == "table" and node.type == "link" and type(node.target) == "table" then
				links[#links + 1] = { text = tostring(node.text or ""), target = node.target }
			end
		end
	end
	scan(item.headline)
	scan(item.subheadline)
	for _, block in ipairs(item.body or {}) do scan(block) end
	scan(item.sourceNote)
	if type(item.earlierReport) == "table" then
		if type(item.earlierReport.target) == "table" then
			links[#links + 1] = { text = tostring(item.earlierReport.label or ""), target = item.earlierReport.target }
		end
		for _, block in ipairs(item.earlierReport.summary or {}) do scan(block) end
	end
	return links
end

