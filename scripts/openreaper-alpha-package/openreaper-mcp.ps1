[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ArgumentList
)

$ErrorActionPreference = "Stop"
$binRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $binRoot "..\vendor\openreaper-kernel\packages\mcp-server\src\openreaper-mcp-stdio.mjs"
$installRoot = [IO.Path]::GetFullPath((Split-Path -Parent $binRoot))
$sessionRoot = if ($env:OPENREAPER_SESSION_ROOT) {
    [IO.Path]::GetFullPath($env:OPENREAPER_SESSION_ROOT)
} else {
    Join-Path $installRoot "session"
}
$serverRoot = Join-Path $installRoot "vendor\openreaper-kernel"

function Resolve-OpenReaperDirectory {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][string] $Label
    )

    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not [IO.Path]::IsPathRooted($resolved)) {
        throw "$Label must be an absolute path: $Path"
    }
    if (Test-Path -LiteralPath $resolved) {
        $item = Get-Item -LiteralPath $resolved -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$Label must not be a reparse-point directory: $resolved"
        }
        if (-not $item.PSIsContainer) {
            throw "$Label must be a directory: $resolved"
        }
    } else {
        New-Item -ItemType Directory -Force -Path $resolved | Out-Null
    }
    return $resolved
}

function Resolve-OpenReaperOptionalPath {
    param(
        [Parameter(Mandatory = $true)][string] $EnvironmentName,
        [Parameter(Mandatory = $true)][string] $DefaultPath
    )

    $configured = [Environment]::GetEnvironmentVariable($EnvironmentName)
    if ($configured) {
        return [IO.Path]::GetFullPath($configured)
    }
    return [IO.Path]::GetFullPath($DefaultPath)
}

$transportRoot = Resolve-OpenReaperDirectory -Path (Resolve-OpenReaperOptionalPath `
    -EnvironmentName "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR" `
    -DefaultPath (Join-Path $sessionRoot "transport")) -Label "Bridge transport root"
$artifactRoot = Resolve-OpenReaperDirectory -Path (Resolve-OpenReaperOptionalPath `
    -EnvironmentName "OPENREAPER_ARTIFACT_ROOT" `
    -DefaultPath (Join-Path $sessionRoot "artifacts")) -Label "artifact root"
$renderRoot = Resolve-OpenReaperDirectory -Path (Resolve-OpenReaperOptionalPath `
    -EnvironmentName "OPENREAPER_LIVE_SMOKE_RENDER_ROOT" `
    -DefaultPath (Join-Path $sessionRoot "renders")) -Label "render root"
$projectIndexRoot = Resolve-OpenReaperDirectory -Path (Resolve-OpenReaperOptionalPath `
    -EnvironmentName "OPENREAPER_PROJECT_INDEX_STATE_ROOT" `
    -DefaultPath (Join-Path $sessionRoot "state")) -Label "Project Index state root"
$recipeRoot = Resolve-OpenReaperDirectory -Path (Resolve-OpenReaperOptionalPath `
    -EnvironmentName "OPENREAPER_EXECUTABLE_RECIPE_ROOT" `
    -DefaultPath (Join-Path (Split-Path -Parent $installRoot) "data\executable-recipes")) -Label "user Recipe root"
$officialRecipeRoot = Resolve-OpenReaperDirectory -Path (Join-Path $sessionRoot "executable-recipes.official") -Label "official Recipe root"

$env:OPENREAPER_MCP_PACKAGE_ROOT = $installRoot
$env:OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR = $transportRoot
$env:OPENREAPER_ARTIFACT_ROOT = $artifactRoot
$env:OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT = $artifactRoot
$env:OPENREAPER_LIVE_SMOKE_RENDER_ROOT = $renderRoot
$env:OPENREAPER_PROJECT_INDEX_STATE_ROOT = $projectIndexRoot
$env:OPENREAPER_EXECUTABLE_RECIPE_ROOT = $recipeRoot
$env:OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT = $officialRecipeRoot
$env:OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH = if ($env:OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH) {
    [IO.Path]::GetFullPath($env:OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH)
} else {
    Join-Path $serverRoot "reaper\bridge\openreaper-live-bridge.lua"
}
$env:OPENREAPER_LIVE_BRIDGE_OWNER = if ($env:OPENREAPER_LIVE_BRIDGE_OWNER) {
    $env:OPENREAPER_LIVE_BRIDGE_OWNER
} else {
    "openreaper-alpha"
}
$generationRecord = Join-Path $sessionRoot "bridge-generation-v1.json"
if (-not $env:OPENREAPER_LIVE_BRIDGE_GENERATION -and (Test-Path -LiteralPath $generationRecord -PathType Leaf)) {
    try {
        $generation = Get-Content -LiteralPath $generationRecord -Raw | ConvertFrom-Json
        if ($generation.contract -eq "openreaper.bridge_generation.v1" -and [int64]$generation.generation -ge 1) {
            $env:OPENREAPER_LIVE_BRIDGE_GENERATION = [string][int64]$generation.generation
        }
    } catch {
        throw "Bridge generation record could not be read safely: $($_.Exception.Message)"
    }
}
if (-not $env:OPENREAPER_LIVE_BRIDGE_GENERATION) {
    $env:OPENREAPER_LIVE_BRIDGE_GENERATION = "1"
}
if (-not $env:OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON) {
    $env:OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON = '["read","write","destructive"]'
}

New-Item -ItemType Directory -Force -Path $transportRoot, (Join-Path $transportRoot "requests"), (Join-Path $transportRoot "results") | Out-Null
if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    throw "Packaged OpenReaper MCP server is missing: $serverScript"
}

function Resolve-OpenReaperNode {
    if ($env:OPENREAPER_NODE_PATH) {
        if (Test-Path -LiteralPath $env:OPENREAPER_NODE_PATH -PathType Leaf) {
            return (Resolve-Path -LiteralPath $env:OPENREAPER_NODE_PATH).Path
        }
        throw "OPENREAPER_NODE_PATH does not point to a regular Node executable: $env:OPENREAPER_NODE_PATH"
    }
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "OpenReaper requires Node.js 20 or newer. Install Node.js or set OPENREAPER_NODE_PATH."
    }
    return $command.Source
}

$node = Resolve-OpenReaperNode
$nodeVersion = (& $node --version 2>$null).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.') {
    throw "Could not determine the Node.js version from $node."
}
if ([int]$Matches[1] -lt 20) {
    throw "OpenReaper requires Node.js 20 or newer. Found $nodeVersion."
}
& $node $serverScript @ArgumentList
exit $LASTEXITCODE
