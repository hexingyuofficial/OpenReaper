param(
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,
  [int]$SessionId = 2,
  [Parameter(Mandatory = $true)]
  [string]$EvidencePath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OpenReaperProjectWarningWin32 {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern IntPtr GetParent(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern int GetDlgCtrlID(IntPtr hWnd);
}
"@

trap {
  $errorPath = "$EvidencePath.error.txt"
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($errorPath)) | Out-Null
  [System.IO.File]::WriteAllText($errorPath, ($_ | Out-String), [System.Text.UTF8Encoding]::new($false))
  exit 1
}

$process = Get-Process -Id $ProcessId
if ($process.SessionId -ne $SessionId) {
  throw "REAPER process $ProcessId is in session $($process.SessionId), expected session $SessionId"
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = [System.Windows.Automation.Condition]::TrueCondition
$allElements = @($root.FindAll([System.Windows.Automation.TreeScope]::Subtree, $condition))
$dialogs = @($allElements | Where-Object {
  $_.Current.ProcessId -eq $ProcessId -and
  $_.Current.ClassName -eq "#32770" -and
  $_.Current.Name -eq "Project Load Warning"
})

if ($dialogs.Count -ne 1) {
  throw "expected exactly one Project Load Warning dialog, found $($dialogs.Count)"
}

$dialog = $dialogs[0]
$windowTitle = $dialog.Current.Name
$windowClass = $dialog.Current.ClassName
$descendants = @($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
$messageElements = @($descendants | Where-Object {
  $_.Current.ClassName -eq "Edit" -and $_.Current.AutomationId -eq "1429"
})
$buttons = @($descendants | Where-Object {
  $_.Current.ClassName -eq "Button" -and
  $_.Current.Name -eq "OK" -and
  $_.Current.AutomationId -eq "1"
})

if ($messageElements.Count -ne 1 -or $buttons.Count -ne 1) {
  throw "expected one exact warning body and OK button, found body=$($messageElements.Count), button=$($buttons.Count)"
}

$message = [regex]::Replace($messageElements[0].Current.Name, "\s+", " ").Trim()
$expectedMarkers = @(
  "There were 1 elements in the project that were saved by extensions.",
  "AU: Pro-Q 3 (FabFilter)",
  "AU: Pro-C 2 (FabFilter)",
  "AU: Pro-L 2 (FabFilter)",
  "Project tokens not recognized:",
  "SWSAUTOCOLOR"
)
foreach ($marker in $expectedMarkers) {
  if ($message -notlike "*$marker*") {
    throw "Project Load Warning body is not the known development fixture: missing marker '$marker'"
  }
}

$buttonHandle = [IntPtr]$buttons[0].Current.NativeWindowHandle
$parentHandle = [OpenReaperProjectWarningWin32]::GetParent($buttonHandle)
$controlId = [OpenReaperProjectWarningWin32]::GetDlgCtrlID($buttonHandle)
$clickMethod = "UIA.InvokePattern"
try {
  $buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
} catch {
  $clickMethod = "Win32.WM_COMMAND_BN_CLICKED"
  if ($buttonHandle -eq [IntPtr]::Zero -or $parentHandle -eq [IntPtr]::Zero -or $controlId -le 0) {
    throw "known Project Load Warning OK button has no usable native handle"
  }
  [OpenReaperProjectWarningWin32]::SendMessage(
    $parentHandle,
    0x0111,
    [IntPtr]$controlId,
    $buttonHandle
  ) | Out-Null
}

Start-Sleep -Milliseconds 750
$remaining = @($root.FindAll([System.Windows.Automation.TreeScope]::Subtree, $condition) | Where-Object {
  $_.Current.ProcessId -eq $ProcessId -and
  $_.Current.ClassName -eq "#32770" -and
  $_.Current.Name -eq "Project Load Warning"
}).Count

$record = [ordered]@{
  contract = "openreaper.windows.development_dialog.project_load_warning.v1"
  observed_at_utc = [DateTime]::UtcNow.ToString("o")
  platform = "Windows"
  process_id = $ProcessId
  session_id = $SessionId
  window_title = $windowTitle
  window_class = $windowClass
  message = $message
  button = "OK"
  button_automation_id = "1"
  exact_match_count = $dialogs.Count
  action = "development_fixture_only"
  reason = "Project contains unavailable AU/SWS extension state on the Windows fixture host."
  product_policy = "user-mediated/fail-closed; never auto-dismiss in shipped runtime"
  click_method = $clickMethod
  exact_dialog_remaining = $remaining
  choice_applied = ($remaining -eq 0)
  outcome = if ($remaining -eq 0) { "closed" } else { "not_closed" }
}

[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($EvidencePath)) | Out-Null
[System.IO.File]::WriteAllText(
  $EvidencePath,
  ($record | ConvertTo-Json -Depth 8),
  [System.Text.UTF8Encoding]::new($false)
)

if ($remaining -ne 0) {
  throw "Project Load Warning remained after bounded development click"
}
