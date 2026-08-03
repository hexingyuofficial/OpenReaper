[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ArgumentList
)

$ErrorActionPreference = "Stop"
$binRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $binRoot "openreaper-doctor.mjs"
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
