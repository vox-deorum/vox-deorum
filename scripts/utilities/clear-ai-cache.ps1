# Clears AI caches, sessions, and logs while keeping credentials, configuration, and memory.
$ErrorActionPreference = 'Stop'

# Returns whether a file system item is a junction or symbolic link.
function Test-Link {
    param($Item)
    return [bool]($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

# Removes a path below a cleanup root after checking that no link between them, or inside the path, redirects the deletion.
function Remove-CacheEntry {
    param([string]$Root, [string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $current = [IO.Path]::GetFullPath($Path)
    while ($current -and $current -ne $rootPath) {
        if (Test-Link (Get-Item -LiteralPath $current -Force)) {
            throw "Cache path contains a link at $current; clear $Path manually."
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    $innerLink = Get-ChildItem -LiteralPath $Path -Recurse -Force |
        Where-Object { Test-Link $_ } |
        Select-Object -First 1
    if ($innerLink) {
        throw "Cache contains a link; remove it manually: $($innerLink.FullName)"
    }
    Write-Host "Clearing $Path"
    Remove-Item -LiteralPath $Path -Recurse -Force
}

try {
    Write-Host 'Stop Vox Agents, Codex proxies, and Claude Code before clearing caches.'

    # Support both the former shared home and the proxy's per-root, per-port instances.
    $proxyRoot = Join-Path $env:USERPROFILE '.codex-openai-proxy'
    $instances = @($proxyRoot)
    if (Test-Path -LiteralPath $proxyRoot) {
        foreach ($root in Get-ChildItem -LiteralPath $proxyRoot -Directory -Force) {
            if ($root.Name -notmatch '^[0-9a-f]{16}$') { continue }
            $instances += $root.FullName
            $instances += @(Get-ChildItem -LiteralPath $root.FullName -Directory -Force |
                Where-Object { $_.Name -match '^ipv[46]-\d+$' } |
                ForEach-Object { $_.FullName })
        }
    }
    foreach ($instance in $instances) {
        Remove-CacheEntry $proxyRoot (Join-Path $instance 'state')
        $codexHome = Join-Path $instance 'codex-home'
        foreach ($name in @('sessions', 'archived_sessions', 'logs', 'shell_snapshots', 'models_cache.json')) {
            Remove-CacheEntry $proxyRoot (Join-Path $codexHome $name)
        }
    }

    $claudeRoot = if ([string]::IsNullOrWhiteSpace($env:CLAUDE_CONFIG_DIR)) {
        Join-Path $env:USERPROFILE '.claude'
    } else {
        $env:CLAUDE_CONFIG_DIR
    }
    foreach ($name in @('cache', 'paste-cache', 'image-cache', 'debug', 'stats-cache.json')) {
        Remove-CacheEntry $claudeRoot (Join-Path $claudeRoot $name)
    }
    $cacheRoot = if ([string]::IsNullOrWhiteSpace($env:XDG_CACHE_HOME)) {
        Join-Path $env:USERPROFILE '.cache'
    } else {
        $env:XDG_CACHE_HOME
    }
    Remove-CacheEntry $cacheRoot (Join-Path $cacheRoot 'claude')
    # Claude Code's bundled env-paths helper uses this native Windows cache location.
    $localAppData = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        Join-Path $env:USERPROFILE 'AppData\Local'
    } else {
        $env:LOCALAPPDATA
    }
    Remove-CacheEntry $localAppData (Join-Path $localAppData 'claude-cli-nodejs\Cache')
    Write-Host 'AI caches cleared.'
} catch {
    Write-Host ('Error clearing AI caches: ' + $_.Exception.Message)
    exit 1
}
