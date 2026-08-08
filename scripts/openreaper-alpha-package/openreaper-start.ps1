[CmdletBinding()]
param(
    [string] $ProjectPath,
    [string] $ReaperBinary,
    [string] $ReaperResourceRoot,
    [string] $InstallRoot,
    [string] $SessionRoot,
    [string] $RenderRoot,
    [string] $BridgeOwner = "openreaper-alpha",
    [string] $BridgeGeneration,
    [string] $EvidenceRoot,
    [int] $TimeoutSeconds = 60,
    [switch] $DirectBinary,
    [switch] $RecoverExisting
)

$ErrorActionPreference = "Stop"
$binRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $InstallRoot) { $InstallRoot = Split-Path -Parent $binRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if (-not $SessionRoot) { $SessionRoot = Join-Path $InstallRoot "session" }
$SessionRoot = [IO.Path]::GetFullPath($SessionRoot)
if (-not $ReaperResourceRoot) {
    $appData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE "AppData\Roaming" }
    $ReaperResourceRoot = Join-Path $appData "REAPER"
}
$ReaperResourceRoot = [IO.Path]::GetFullPath($ReaperResourceRoot)
$transportRoot = Join-Path $SessionRoot "transport"
$artifactRoot = Join-Path $SessionRoot "artifacts"
$projectIndexRoot = Join-Path $SessionRoot "project-index"
$generationRecord = Join-Path $SessionRoot "bridge-generation-v1.json"
$pidPath = Join-Path $SessionRoot "reaper.pid"
$logRoot = Join-Path $SessionRoot "logs"
$bridgeScript = Join-Path $InstallRoot "vendor\openreaper-kernel\reaper\bridge\openreaper-live-bridge.lua"
$doctorScript = Join-Path $binRoot "openreaper-doctor.ps1"
$startupStatusPath = Join-Path $transportRoot "openreaper-startup-status-v1.json"
$heartbeatPath = Join-Path $transportRoot "openreaper-bridge-liveness-v1.json"
$launchStarted = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$doctorSmokeTimeoutMs = 22000
$doctorReadProbeTimeoutMs = 15000

function Fail([string] $Message) {
    Write-Error "[OpenReaper] $Message"
    exit 2
}

function Quote-ProcessArgument([string] $Value) {
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Assert-AbsolutePath([string] $Value, [string] $Label) {
    if (-not $Value -or -not [IO.Path]::IsPathRooted($Value)) { Fail "$Label must be an absolute path." }
}

function Read-Generation {
    if (-not (Test-Path -LiteralPath $generationRecord -PathType Leaf)) { return 0 }
    try {
        $record = Get-Content -LiteralPath $generationRecord -Raw | ConvertFrom-Json
        if ($record.contract -ne "openreaper.bridge_generation.v1" -or [int64]$record.generation -lt 1) {
            Fail "bridge generation record is invalid: $generationRecord"
        }
        return [int64]$record.generation
    } catch {
        Fail "bridge generation record could not be read safely: $($_.Exception.Message)"
    }
}

function Write-Generation([int64] $Generation) {
    $payload = @{ contract = "openreaper.bridge_generation.v1"; generation = $Generation } | ConvertTo-Json -Compress
    $temporary = "$generationRecord.tmp.$PID"
    Set-Content -LiteralPath $temporary -Value "$payload`n" -Encoding UTF8 -NoNewline
    Move-Item -LiteralPath $temporary -Destination $generationRecord -Force
}

function Resolve-ReaperBinary {
    if ($ReaperBinary) {
        Assert-AbsolutePath $ReaperBinary "-ReaperBinary"
        if (-not (Test-Path -LiteralPath $ReaperBinary -PathType Leaf)) { Fail "REAPER binary was not found: $ReaperBinary" }
        return [IO.Path]::GetFullPath($ReaperBinary)
    }
    $candidates = @(
        (Join-Path ${env:ProgramFiles} "REAPER (x64)\reaper.exe"),
        (Join-Path ${env:ProgramFiles} "REAPER\reaper.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "REAPER (x86)\reaper.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "REAPER\reaper.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\REAPER\reaper.exe")
    )
    $candidates = @($candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
    if (-not $candidates) { Fail "REAPER was not found. Pass -ReaperBinary with the installed reaper.exe path." }
    return [IO.Path]::GetFullPath($candidates[0])
}

function Get-RunningReaperProcesses {
    @(
        Get-Process -Name reaper -ErrorAction SilentlyContinue | ForEach-Object {
            [pscustomobject]@{
                id = $_.Id
                path = try { $_.Path } catch { $null }
            }
        }
    )
}

function Get-OpenReaperStartupWindowGate([int] $ProcessId) {
    try {
        if (-not ("OpenReaperNativeWindowProbe" -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class OpenReaperNativeWindowProbe {
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);

    public static string[] VisibleTopLevelWindows(int targetProcessId) {
        var windows = new List<string>();
        EnumWindows((hWnd, lParam) => {
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (processId != (uint)targetProcessId || !IsWindowVisible(hWnd)) return true;
            var title = new StringBuilder(1024);
            var className = new StringBuilder(256);
            GetWindowText(hWnd, title, title.Capacity);
            GetClassName(hWnd, className, className.Capacity);
            windows.Add(className.ToString() + "\u001f" + title.ToString());
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@ | Out-Null
        }
        $windows = @([OpenReaperNativeWindowProbe]::VisibleTopLevelWindows($ProcessId) | ForEach-Object {
            $parts = $_ -split [char]0x1f, 2
            [pscustomobject]@{ class_name = $parts[0]; title = if ($parts.Count -gt 1) { $parts[1] } else { "" } }
        })
    } catch {
        return [pscustomobject]@{ state = "blocked"; detail = "window_inspection_failed:$($_.Exception.GetType().Name)" }
    }
    if ($windows.Count -eq 0) {
        return [pscustomobject]@{ state = "pending"; detail = "no_visible_reaper_window" }
    }
    $mainWindows = @($windows | Where-Object { $_.class_name -eq "REAPERwnd" })
    $unexpected = @($windows | Where-Object { $_.class_name -ne "REAPERwnd" })
    if ($mainWindows.Count -ne 1 -or $unexpected.Count -ne 0) {
        $observed = ($windows | ForEach-Object { "class=$($_.class_name);title=$($_.title)" }) -join " | "
        return [pscustomobject]@{ state = "blocked"; detail = "dialog_or_unknown_window:$observed" }
    }
    return [pscustomobject]@{ state = "safe"; detail = "reaper_main_window_only" }
}

Assert-AbsolutePath $InstallRoot "-InstallRoot"
Assert-AbsolutePath $SessionRoot "-SessionRoot"
Assert-AbsolutePath $ReaperResourceRoot "-ReaperResourceRoot"
if ($RenderRoot) { Assert-AbsolutePath $RenderRoot "-RenderRoot" }
if (-not (Test-Path -LiteralPath $bridgeScript -PathType Leaf)) { Fail "Packaged Bridge script is missing: $bridgeScript" }
if (-not (Test-Path -LiteralPath $doctorScript -PathType Leaf)) { Fail "Packaged Doctor is missing: $doctorScript" }

$binary = Resolve-ReaperBinary
$runningReaperProcesses = @(Get-RunningReaperProcesses)
$existingPid = $null
$existingProcess = $null
if (Test-Path -LiteralPath $pidPath -PathType Leaf) {
    $existingPid = [int]((Get-Content -LiteralPath $pidPath -Raw).Trim())
}
if ($existingPid) {
    $existingProcess = $runningReaperProcesses | Where-Object { $_.id -eq $existingPid } | Select-Object -First 1
}
if ($existingProcess) {
    if (-not $RecoverExisting) { Fail "A managed REAPER session is already running (pid=$existingPid); refusing duplicate startup." }
    $BridgeGeneration = [string](Read-Generation)
} else {
    if ($runningReaperProcesses.Count -gt 0) {
        $details = ($runningReaperProcesses | ForEach-Object {
            $path = if ($_.path) { $_.path } else { "path-unavailable" }
            "pid=$($_.id),path=$path"
        }) -join "; "
        Fail "An unmanaged REAPER process is already running ($details); close it and retry. Refusing duplicate startup to protect REAPER configuration and Bridge identity."
    }
    $previousGeneration = Read-Generation
    if ($BridgeGeneration) {
        if ($BridgeGeneration -notmatch '^[1-9][0-9]*$') { Fail "-BridgeGeneration must be a positive integer." }
        $nextGeneration = [int64]$BridgeGeneration
        if ($nextGeneration -lt $previousGeneration) { Fail "-BridgeGeneration would move the managed generation backwards." }
    } else {
        $nextGeneration = [Math]::Max(1, $previousGeneration + 1)
    }
    $BridgeGeneration = [string]$nextGeneration
    New-Item -ItemType Directory -Force -Path $SessionRoot | Out-Null
    Write-Generation $nextGeneration
}

New-Item -ItemType Directory -Force -Path $ReaperResourceRoot | Out-Null
New-Item -ItemType Directory -Force -Path $transportRoot, (Join-Path $transportRoot "requests"), (Join-Path $transportRoot "results"), $artifactRoot, $projectIndexRoot, $logRoot | Out-Null
if (-not $RenderRoot) {
    $managedRecord = Join-Path $SessionRoot "managed-render-root.path"
    if (Test-Path -LiteralPath $managedRecord -PathType Leaf) {
        $RenderRoot = (Get-Content -LiteralPath $managedRecord -Raw -Encoding UTF8).Trim()
    }
    if (-not $RenderRoot) { $RenderRoot = Join-Path $SessionRoot "renders" }
}
Assert-AbsolutePath $RenderRoot "effective render root"
New-Item -ItemType Directory -Force -Path $RenderRoot | Out-Null

$resourceConfigFile = Join-Path $ReaperResourceRoot "REAPER.ini"
$launchArgs = @(
    "-cfgfile", (Quote-ProcessArgument $resourceConfigFile)
)
if ($ProjectPath) {
    Assert-AbsolutePath $ProjectPath "-ProjectPath"
    if (-not (Test-Path -LiteralPath $ProjectPath -PathType Leaf)) { Fail "Project was not found: $ProjectPath" }
    $launchArgs += (Quote-ProcessArgument $ProjectPath)
}
$env:OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR = $transportRoot
$env:OPENREAPER_SESSION_ROOT = $SessionRoot
$env:OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH = $bridgeScript
$env:OPENREAPER_ARTIFACT_ROOT = $artifactRoot
$env:OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT = $artifactRoot
$env:OPENREAPER_LIVE_SMOKE_RENDER_ROOT = $RenderRoot
$env:OPENREAPER_LIVE_BRIDGE_OWNER = $BridgeOwner
$env:OPENREAPER_LIVE_BRIDGE_GENERATION = $BridgeGeneration
$env:OPENREAPER_PROJECT_INDEX_STATE_ROOT = $projectIndexRoot
$env:OPENREAPER_MCP_PACKAGE_ROOT = $InstallRoot
if ($ProjectPath) { $env:OPENREAPER_CURRENT_PROJECT_PATH = [IO.Path]::GetFullPath($ProjectPath) }

$logPath = Join-Path $logRoot ("openreaper-start-{0}.log" -f ([DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")))
$launchInfo = @{
    contract = "openreaper.windows.start.v1"
    install_root = $InstallRoot
    session_root = $SessionRoot
    reaper_binary = $binary
    reaper_resource_root = $ReaperResourceRoot
    reaper_config_file = $resourceConfigFile
    bridge_owner = $BridgeOwner
    bridge_generation = [int64]$BridgeGeneration
    project_path = if ($ProjectPath) { [IO.Path]::GetFullPath($ProjectPath) } else { $null }
    started_at_utc = [DateTimeOffset]::UtcNow.ToString("o")
}
$launchInfo | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $logPath -Encoding UTF8

$process = $null
if (-not $existingProcess) {
    if ($launchArgs.Count -gt 0) {
        # Keep the launcher host hidden while making the REAPER GUI explicit.
        $process = Start-Process -FilePath $binary -ArgumentList $launchArgs -WorkingDirectory (Split-Path -Parent $binary) -WindowStyle Normal -PassThru
    } else {
        $process = Start-Process -FilePath $binary -WorkingDirectory (Split-Path -Parent $binary) -WindowStyle Normal -PassThru
    }
    Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ASCII
} else {
    $process = Get-Process -Id $existingPid
}

function Test-HeartbeatReady {
    if (-not (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) { return $false }
    try {
        $heartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
        $mtime = (Get-Item -LiteralPath $heartbeatPath).LastWriteTimeUtc
        $ageMs = ([DateTime]::UtcNow - $mtime).TotalMilliseconds
        return ($heartbeat.contract -eq "openreaper.bridge_liveness.v1" -and
            $heartbeat.active_owner -eq $BridgeOwner -and
            [int64]$heartbeat.active_generation -eq [int64]$BridgeGeneration -and
            [int64]$heartbeat.sequence -ge 1 -and
            [int64]$heartbeat.refreshed_at_unix_s * 1000 -ge ($launchStarted - 2000) -and
            $ageMs -ge -1000 -and $ageMs -le 35000)
    } catch { return $false }
}

$deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(5, $TimeoutSeconds))
$lastWindowGate = $null
while ([DateTime]::UtcNow -lt $deadline) {
    if ($process.HasExited) { Fail "REAPER exited before Bridge readiness. pid=$($process.Id); log=$logPath" }
    $windowGate = Get-OpenReaperStartupWindowGate $process.Id
    if ($windowGate.state -eq "blocked") {
        Fail "REAPER startup dialog blocker ($($windowGate.detail)); preserve the dialog for user-mediated resolution and retry. log=$logPath"
    }
    if ($windowGate.state -eq "pending") {
        $lastWindowGate = $windowGate.detail
        Start-Sleep -Milliseconds 250
        continue
    }
    if (Test-HeartbeatReady) { break }
    Start-Sleep -Milliseconds 250
}
if (-not (Test-HeartbeatReady)) {
    $stage = if (Test-Path -LiteralPath $startupStatusPath -PathType Leaf) { (Get-Content -LiteralPath $startupStatusPath -Raw).Trim() } else { "missing" }
    $windowDetail = if ($lastWindowGate) { "; window_gate=$lastWindowGate" } else { "" }
    Fail "Bridge heartbeat did not become ready for owner=$BridgeOwner generation=$BridgeGeneration; startup_status=$stage$windowDetail; log=$logPath"
}

$doctorArgs = @("--wait-bridge=5")
if ($ProjectPath) { $doctorArgs += "--for=project-query" }
$env:OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS = [string]$doctorSmokeTimeoutMs
$env:OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS = [string]$doctorReadProbeTimeoutMs
$doctorOutput = & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $doctorScript @doctorArgs 2>&1
$doctorOutput | Tee-Object -FilePath $logPath -Append | Write-Output
if ($LASTEXITCODE -ne 0) { Fail "Doctor public read probe failed; log=$logPath" }
Write-Output "[OpenReaper] startup-status=ready"
Write-Output "[OpenReaper] bridge-status=ready"
Write-Output "[OpenReaper] public-read-probe=passed"
Write-Output "[OpenReaper] reaper-pid=$($process.Id)"
Write-Output "[OpenReaper] generation=$BridgeGeneration"
Write-Output "[OpenReaper] log=$logPath"
