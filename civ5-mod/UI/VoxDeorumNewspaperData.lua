-- Pure publication indexing and text adapters for Vox Deorum newspaper viewers.

VoxDeorumNewspaperData = VoxDeorumNewspaperData or {}

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

-- Collect typed links from one item's headline, deck, body, record, and history.
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
	scan(item.deck)
	for _, block in ipairs(item.body or {}) do scan(block) end
	scan(item.record)
	if type(item.history) == "table" then
		if type(item.history.target) == "table" then
			links[#links + 1] = { text = tostring(item.history.label or ""), target = item.history.target }
		end
		for _, block in ipairs(item.history.body or {}) do scan(block) end
	end
	return links
end

