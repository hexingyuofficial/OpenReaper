[CmdletBinding()]
param(
    [string] $ProjectPath
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeArgs = @("$root\studio-orchestrate.mjs", "start")
if ($ProjectPath) {
    $nodeArgs += @("--project-path", $ProjectPath)
}
& node @nodeArgs
