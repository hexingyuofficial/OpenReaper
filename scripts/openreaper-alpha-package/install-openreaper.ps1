[CmdletBinding()]
param(
    [string] $InstallRoot,
    [string] $ReaperResourceRoot,
    [string] $RenderRoot,
    [string] $EvidenceRoot,
    [switch] $SkipClientConfig,
    [switch] $SkipStartupHook
)

$ErrorActionPreference = "Stop"
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $packageRoot "installer\install-openreaper.mjs"
$nodePath = $env:OPENREAPER_NODE_PATH
if (-not $nodePath) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodePath = $nodeCommand.Source }
}
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "OpenReaper installation requires Node.js 20 or newer. Install Node.js or set OPENREAPER_NODE_PATH."
}
if (-not $InstallRoot) { $InstallRoot = Join-Path $env:LOCALAPPDATA "OpenReaper\current" }
if (-not $ReaperResourceRoot) {
    $appData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE "AppData\Roaming" }
    $ReaperResourceRoot = Join-Path $appData "REAPER"
}
if (-not $EvidenceRoot) { $EvidenceRoot = Join-Path (Split-Path -Parent $InstallRoot) "evidence" }
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null

function Get-ExternalManifest {
    param([string] $Destination)
    $roots = @($InstallRoot, $ReaperResourceRoot, (Join-Path $env:USERPROFILE ".codex\config.toml"), (Join-Path $env:USERPROFILE ".cursor\mcp.json"), (Join-Path $env:APPDATA "Claude\claude_desktop_config.json"))
    $files = foreach ($root in $roots) {
        if (Test-Path -LiteralPath $root -PathType Leaf) {
            $item = Get-Item -LiteralPath $root
            [pscustomobject]@{ path = $item.FullName; relative = $null; length = $item.Length; sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
        } elseif (Test-Path -LiteralPath $root -PathType Container) {
            $base = (Get-Item -LiteralPath $root).FullName
            Get-ChildItem -LiteralPath $base -File -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                [pscustomobject]@{ path = $_.FullName; relative = $_.FullName.Substring($base.Length).TrimStart("\"); length = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
            }
        }
    }
    [pscustomobject]@{
        contract = "openreaper.windows.external_manifest.v1"
        captured_at_utc = [DateTimeOffset]::UtcNow.ToString("o")
        owned_install_root = [IO.Path]::GetFullPath($InstallRoot)
        reaper_resource_root = [IO.Path]::GetFullPath($ReaperResourceRoot)
        files = @($files)
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Destination -Encoding UTF8
}

$before = Join-Path $EvidenceRoot "install-before.json"
$after = Join-Path $EvidenceRoot "install-after.json"
Get-ExternalManifest $before
$arguments = @("$nodeScript", "--install-root", $InstallRoot, "--reaper-resource-root", $ReaperResourceRoot)
if ($RenderRoot) { $arguments += @("--render-root", $RenderRoot) }
if ($SkipClientConfig) { $arguments += "--skip-client-config" }
if ($SkipStartupHook) { $arguments += "--skip-startup-hook" }
& $nodePath @arguments 2>&1 | Tee-Object -FilePath (Join-Path $EvidenceRoot "install.log") | Write-Output
$exitCode = $LASTEXITCODE
Get-ExternalManifest $after
if ($exitCode -ne 0) { throw "OpenReaper installer failed with exit code $exitCode. See $EvidenceRoot\install.log" }
Write-Output "[OpenReaper] installed; before=$before; after=$after"
