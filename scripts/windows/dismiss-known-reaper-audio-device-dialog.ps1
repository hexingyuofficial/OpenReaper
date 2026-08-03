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
public static class OpenReaperDevelopmentWin32 {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern IntPtr GetParent(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern int GetDlgCtrlID(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetDlgItem(IntPtr hDlg, int nIDDlgItem);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("kernel32.dll")]
  public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
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

$expectedMessage = "You have not yet selected an audio device. Would you like to select your audio device driver now (recommended)?"
$root = [System.Windows.Automation.AutomationElement]::RootElement
$matches = @()
$allElements = @($root.FindAll(
  [System.Windows.Automation.TreeScope]::Subtree,
  [System.Windows.Automation.Condition]::TrueCondition
))

foreach ($window in @($allElements | Where-Object {
  $_.Current.ProcessId -eq $ProcessId -and
  $_.Current.ClassName -eq "#32770" -and
  $_.Current.Name -eq "REAPER"
})) {
  if ($window.Current.ClassName -ne "#32770" -or $window.Current.Name -ne "REAPER") {
    continue
  }

  $descendants = @($window.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  ))
  $messageMatches = @($descendants | Where-Object {
    $_.Current.ClassName -eq "Static" -and
    ([regex]::Replace($_.Current.Name, "\s+", " ").Trim() -eq $expectedMessage)
  })
  $noButtons = @($descendants | Where-Object {
    $_.Current.ClassName -eq "Button" -and
    $_.Current.AutomationId -eq "7"
  })

  if ($messageMatches.Count -eq 1 -and $noButtons.Count -eq 1) {
    $matches += [pscustomobject]@{
      window = $window
      button = $noButtons[0]
      message = $messageMatches[0].Current.Name
    }
  }
}

if ($matches.Count -ne 1) {
  throw "expected exactly one exact audio-device dialog, found $($matches.Count)"
}

function Get-ExactDialogCount {
  @($root.FindAll([System.Windows.Automation.TreeScope]::Subtree, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
    $_.Current.ProcessId -eq $ProcessId -and
    $_.Current.ClassName -eq "#32770" -and $_.Current.Name -eq "REAPER"
  }).Count
}

$record = [ordered]@{
  observed_at_utc = [DateTime]::UtcNow.ToString("o")
  platform = "Windows"
  process_id = $ProcessId
  session_id = $SessionId
  window_title = "REAPER"
  window_class = "#32770"
  message = $matches[0].message
  normalized_message = $expectedMessage
  requested_choice = "No"
  button_automation_id = "7"
  exact_match_count = $matches.Count
  action = "development_fixture_only"
  reason = "No audio device is configured; continue without opening audio-device configuration."
  product_policy = "Do not auto-dismiss in shipped runtime without an explicit typed contract."
  supported_patterns = @($matches[0].button.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
}

$consoleHandle = [OpenReaperDevelopmentWin32]::GetConsoleWindow()
if ($consoleHandle -ne [IntPtr]::Zero) {
  [OpenReaperDevelopmentWin32]::ShowWindow($consoleHandle, 0) | Out-Null
}

$clickMethod = "InvokePattern"
$buttonHandle = [IntPtr]::Zero
$parentHandle = [IntPtr]::Zero
$buttonControlId = 0
try {
  $matches[0].button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
} catch [System.InvalidOperationException] {
  try {
    $legacyPattern = [System.Windows.Automation.AutomationPattern]::LookupById(10018)
    $legacy = $matches[0].button.GetCurrentPattern($legacyPattern)
    $legacyMethod = $legacy.GetType().GetMethod("DoDefaultAction")
    if ($null -eq $legacyMethod) {
      throw "legacy accessibility pattern has no DoDefaultAction method"
    }
    $legacyMethod.Invoke($legacy, [object[]]@()) | Out-Null
    $clickMethod = "UIA.LegacyIAccessiblePattern.DoDefaultAction"
  } catch {
    $clickMethod = "Win32.WM_COMMAND_BN_CLICKED"
    $buttonHandle = [IntPtr]$matches[0].button.Current.NativeWindowHandle
    if ($buttonHandle -eq [IntPtr]::Zero) {
      throw "exact audio-device No button has no native window handle"
    }
  $parentHandle = [OpenReaperDevelopmentWin32]::GetParent($buttonHandle)
  $buttonControlId = [OpenReaperDevelopmentWin32]::GetDlgCtrlID($buttonHandle)
  $dialogItemHandle = [OpenReaperDevelopmentWin32]::GetDlgItem($parentHandle, $buttonControlId)
  if ($dialogItemHandle -ne [IntPtr]::Zero) {
    $buttonHandle = $dialogItemHandle
  }
  [OpenReaperDevelopmentWin32]::ShowWindow($parentHandle, 5) | Out-Null
  [OpenReaperDevelopmentWin32]::SetWindowPos($parentHandle, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
  [OpenReaperDevelopmentWin32]::BringWindowToTop($parentHandle) | Out-Null
  [OpenReaperDevelopmentWin32]::SetForegroundWindow($parentHandle) | Out-Null
  [OpenReaperDevelopmentWin32]::SetActiveWindow($parentHandle) | Out-Null
  [OpenReaperDevelopmentWin32]::SetFocus($buttonHandle) | Out-Null
    $firstMessageResult = [OpenReaperDevelopmentWin32]::SendMessage($buttonHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 250
    if ((Get-ExactDialogCount) -gt 0) {
      $commandResult = [OpenReaperDevelopmentWin32]::SendMessage(
        $parentHandle,
        0x0111,
        [IntPtr]$buttonControlId,
        $buttonHandle
      )
    }
    Start-Sleep -Milliseconds 250
    if ((Get-ExactDialogCount) -gt 0) {
      $clickMethod = "Win32.MouseClickExactUiRect"
      $rect = $matches[0].button.Current.BoundingRectangle
      if ($rect.Width -le 0 -or $rect.Height -le 0) {
        throw "exact audio-device No button has no usable bounding rectangle"
      }
      $centerX = [int][Math]::Round($rect.X + ($rect.Width / 2))
      $centerY = [int][Math]::Round($rect.Y + ($rect.Height / 2))
      [OpenReaperDevelopmentWin32]::SetForegroundWindow($parentHandle) | Out-Null
      [OpenReaperDevelopmentWin32]::SetCursorPos($centerX, $centerY) | Out-Null
      [OpenReaperDevelopmentWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      [OpenReaperDevelopmentWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 250
      if ((Get-ExactDialogCount) -gt 0) {
        $clickMethod = "Win32.WM_LBUTTONDOWN_UP_ExactButton"
        $localX = [int][Math]::Round($rect.Width / 2)
        $localY = [int][Math]::Round($rect.Height / 2)
        $lParam = [IntPtr](($localY -shl 16) -bor $localX)
        [OpenReaperDevelopmentWin32]::SendMessage($buttonHandle, 0x0201, [IntPtr]1, $lParam) | Out-Null
        [OpenReaperDevelopmentWin32]::SendMessage($buttonHandle, 0x0202, [IntPtr]0, $lParam) | Out-Null
        Start-Sleep -Milliseconds 250
      if ((Get-ExactDialogCount) -gt 0) {
        $clickMethod = "Win32.WM_KEYDOWN_UP_SPACE_ExactButton"
        $spaceDownResult = [OpenReaperDevelopmentWin32]::SendMessage($buttonHandle, 0x0100, [IntPtr]0x20, [IntPtr]0)
        $spaceUpResult = [OpenReaperDevelopmentWin32]::SendMessage($buttonHandle, 0x0101, [IntPtr]0x20, [IntPtr]0)
        Start-Sleep -Milliseconds 250
        if ((Get-ExactDialogCount) -gt 0) {
          $clickMethod = "WScript.AppActivate_AltN_ExactDialog"
          $shell = New-Object -ComObject WScript.Shell
          $activated = $shell.AppActivate($ProcessId)
          Start-Sleep -Milliseconds 150
          $shell.SendKeys("%n")
          Start-Sleep -Milliseconds 250
          if ((Get-ExactDialogCount) -gt 0) {
            $clickMethod = "Win32.WM_CLOSE_ExactDialog"
            $closeResult = [OpenReaperDevelopmentWin32]::SendMessage($parentHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
          }
        }
      }
      }
    }
  }
}
Start-Sleep -Milliseconds 750
$remainingDialogs = Get-ExactDialogCount
$record.after = [ordered]@{
  click_method = $clickMethod
  button_native_window_handle = if ($buttonHandle) { $buttonHandle.ToInt64() } else { $null }
  dialog_item_window_handle = if ($dialogItemHandle) { $dialogItemHandle.ToInt64() } else { $null }
  button_parent_window_handle = if ($parentHandle -ne [IntPtr]::Zero) { $parentHandle.ToInt64() } else { $null }
  button_control_id = $buttonControlId
  button_rect = if ($rect) { [ordered]@{ x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height } } else { $null }
  first_message_result = if ($firstMessageResult) { $firstMessageResult.ToInt64() } else { $null }
  command_result = if ($commandResult) { $commandResult.ToInt64() } else { $null }
  space_down_result = if ($spaceDownResult) { $spaceDownResult.ToInt64() } else { $null }
  space_up_result = if ($spaceUpResult) { $spaceUpResult.ToInt64() } else { $null }
  close_result = if ($closeResult) { $closeResult.ToInt64() } else { $null }
  exact_dialog_remaining = $remainingDialogs
  choice_applied = ($remainingDialogs -eq 0)
}
$record.outcome = if ($record.after.choice_applied) { "closed" } else { "not_closed" }

if ($record.after.exact_dialog_remaining -gt 0 -and $parentHandle -ne [IntPtr]::Zero) {
  [OpenReaperDevelopmentWin32]::SetWindowPos($parentHandle, [IntPtr](-2), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0040) | Out-Null
}

[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($EvidencePath)) | Out-Null
[System.IO.File]::WriteAllText(
  $EvidencePath,
  ($record | ConvertTo-Json -Depth 8),
  [System.Text.UTF8Encoding]::new($false)
)
