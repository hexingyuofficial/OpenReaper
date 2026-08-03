[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $ArgumentList
)

$ErrorActionPreference = "Stop"
$binRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $binRoot "..\vendor\openreaper-kernel\packages\mcp-server\src\openreaper-mcp-stdio.mjs"

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
if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    throw "Packaged OpenReaper MCP server is missing: $serverScript"
}

& $node $serverScript @ArgumentList
exit $LASTEXITCODE
