[CmdletBinding()]
param(
    [string] $InstallRoot,
    [string] $ReaperResourceRoot,
    [string] $EvidenceRoot,
    [switch] $SkipClientConfig,
    [switch] $SkipStartupHook
)

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $packageRoot "installer\uninstall-openreaper.mjs"
$nodePath = $env:OPENREAPER_NODE_PATH
if (-not $nodePath) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodePath = $nodeCommand.Source }
}
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "OpenReaper uninstallation requires Node.js 20 or newer. Install Node.js or set OPENREAPER_NODE_PATH."
}
if (-not $InstallRoot) { $InstallRoot = Join-Path $env:LOCALAPPDATA "OpenReaper\current" }
if (-not $ReaperResourceRoot) {
    $appData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE "AppData\Roaming" }
    $ReaperResourceRoot = Join-Path $appData "REAPER"
}
if (-not $EvidenceRoot) { $EvidenceRoot = Join-Path (Split-Path -Parent $InstallRoot) "evidence" }
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null

function Get-PathManifest {
    param([string] $Destination)
    $targets = @($InstallRoot, $ReaperResourceRoot, (Join-Path $env:USERPROFILE ".codex\config.toml"), (Join-Path $env:USERPROFILE ".cursor\mcp.json"), (Join-Path $env:APPDATA "Claude\claude_desktop_config.json"))
    $rows = foreach ($target in $targets) {
        if (Test-Path -LiteralPath $target -PathType Leaf) {
            $item = Get-Item -LiteralPath $target
            [pscustomobject]@{ path = $item.FullName; length = $item.Length; sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
        } elseif (Test-Path -LiteralPath $target -PathType Container) {
            Get-ChildItem -LiteralPath $target -File -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                [pscustomobject]@{ path = $_.FullName; length = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
            }
        }
    }
    [pscustomobject]@{ contract = "openreaper.windows.external_manifest.v1"; captured_at_utc = [DateTimeOffset]::UtcNow.ToString("o"); files = @($rows) } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Destination -Encoding UTF8
}

$before = Join-Path $EvidenceRoot "uninstall-before.json"
$after = Join-Path $EvidenceRoot "uninstall-after.json"
Get-PathManifest $before
$arguments = @("$nodeScript", "--install-root", $InstallRoot, "--reaper-resource-root", $ReaperResourceRoot)
if ($SkipClientConfig) { $arguments += "--skip-client-config" }
if ($SkipStartupHook) { $arguments += "--skip-startup-hook" }
& $nodePath @arguments 2>&1 | Tee-Object -FilePath (Join-Path $EvidenceRoot "uninstall.log") | Write-Output
$exitCode = $LASTEXITCODE
Get-PathManifest $after
if ($exitCode -ne 0) { throw "OpenReaper uninstaller failed with exit code $exitCode. See $EvidenceRoot\uninstall.log" }
Write-Output "[OpenReaper] uninstalled; before=$before; after=$after"
