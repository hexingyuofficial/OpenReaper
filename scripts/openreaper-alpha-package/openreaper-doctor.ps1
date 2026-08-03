[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ArgumentList
)

$ErrorActionPreference = "Stop"
$binRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $binRoot "openreaper-doctor.mjs"
$installRoot = [IO.Path]::GetFullPath((Split-Path -Parent $binRoot))
$sessionRoot = if ($env:OPENREAPER_SESSION_ROOT) { [IO.Path]::GetFullPath($env:OPENREAPER_SESSION_ROOT) } else { Join-Path $installRoot "session" }
$transportRoot = if ($env:OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR) { [IO.Path]::GetFullPath($env:OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR) } else { Join-Path $sessionRoot "transport" }
$artifactRoot = if ($env:OPENREAPER_ARTIFACT_ROOT) {
    [IO.Path]::GetFullPath($env:OPENREAPER_ARTIFACT_ROOT)
} elseif ($env:OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT) {
    [IO.Path]::GetFullPath($env:OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT)
} else {
    Join-Path $sessionRoot "artifacts"
}
$recipeRoot = if ($env:OPENREAPER_EXECUTABLE_RECIPE_ROOT) {
    [IO.Path]::GetFullPath($env:OPENREAPER_EXECUTABLE_RECIPE_ROOT)
} else {
    Join-Path (Split-Path -Parent $installRoot) "data\executable-recipes"
}
$env:OPENREAPER_DOCTOR_INSTALL_ROOT = $installRoot
$env:OPENREAPER_DOCTOR_SESSION_ROOT = $sessionRoot
$env:OPENREAPER_DOCTOR_TRANSPORT_DIR = $transportRoot
$env:OPENREAPER_DOCTOR_ARTIFACT_ROOT = $artifactRoot
$env:OPENREAPER_DOCTOR_EXECUTABLE_RECIPE_ROOT = $recipeRoot
$nodePath = $env:OPENREAPER_NODE_PATH
if (-not $nodePath) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodePath = $nodeCommand.Source }
}
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "OpenReaper Doctor requires Node.js 20 or newer. Install Node.js or set OPENREAPER_NODE_PATH."
}
if (-not (Test-Path -LiteralPath $nodeScript -PathType Leaf)) {
    throw "Packaged OpenReaper Doctor runtime is missing: $nodeScript"
}

& $nodePath $nodeScript @ArgumentList
exit $LASTEXITCODE
