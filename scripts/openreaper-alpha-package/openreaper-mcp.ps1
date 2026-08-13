[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ArgumentList
)

$ErrorActionPreference = "Stop"
$binRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $binRoot "..\vendor\openreaper-kernel\packages\mcp-server\src\openreaper-mcp-stdio.mjs"
$bootstrapScript = Join-Path $binRoot "openreaper-mcp-bootstrap.mjs"
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
$generationCandidates = @(
    @{ Path = (Join-Path $transportRoot "openreaper-bridge-liveness-v1.json"); Contract = "openreaper.bridge_liveness.v1"; Field = "active_generation"; OwnerField = "active_owner" },
    @{ Path = (Join-Path $sessionRoot "bridge-generation-v1.json"); Contract = "openreaper.bridge_generation.v1"; Field = "generation"; OwnerField = $null }
)
if (-not $env:OPENREAPER_LIVE_BRIDGE_GENERATION) {
    foreach ($candidate in $generationCandidates) {
        if (-not (Test-Path -LiteralPath $candidate.Path -PathType Leaf)) { continue }
        try {
            $item = Get-Item -LiteralPath $candidate.Path -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.Length -gt 2048) {
                throw "generation source must be a bounded regular non-reparse-point file"
            }
            $record = Get-Content -LiteralPath $candidate.Path -Raw | ConvertFrom-Json
            if ($record.contract -ne $candidate.Contract) { continue }
            if ($candidate.OwnerField -and [string]$record.($candidate.OwnerField) -ne $env:OPENREAPER_LIVE_BRIDGE_OWNER) { continue }
            $generation = [int64]$record.($candidate.Field)
            if ($generation -ge 1) {
                $env:OPENREAPER_LIVE_BRIDGE_GENERATION = [string]$generation
                break
            }
        } catch {
            throw "Bridge generation source could not be read safely: $($_.Exception.Message)"
        }
    }
}
if (-not $env:OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON) {
    $env:OPENREAPER_EXECUTABLE_RECIPE_RISK_GRANTS_JSON = '["read","write","destructive"]'
}

New-Item -ItemType Directory -Force -Path $transportRoot, (Join-Path $transportRoot "requests"), (Join-Path $transportRoot "results") | Out-Null
if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    throw "Packaged OpenReaper MCP server is missing: $serverScript"
}
if (-not (Test-Path -LiteralPath $bootstrapScript -PathType Leaf)) {
    throw "Packaged OpenReaper MCP bootstrap is missing: $bootstrapScript"
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
& $node $bootstrapScript $serverScript @ArgumentList
exit $LASTEXITCODE
