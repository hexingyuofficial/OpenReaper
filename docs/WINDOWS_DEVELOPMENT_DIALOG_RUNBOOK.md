# Windows Development Dialog Runbook

This is a development-fixture runbook. It is not a shipped runtime policy and
the helper named here is not included in the packaged user entrypoints.

## Known REAPER audio-device prompt

On a Windows host with no configured audio device, stock REAPER 7.78 can show
this exact prompt during first launch:

- window title: `REAPER`
- top-level class: `#32770`
- normalized body: `You have not yet selected an audio device. Would you like to select your audio device driver now (recommended)?`
- button class: `Button`
- safe development choice: button `AutomationId=7` (`No`)

The development choice keeps REAPER open without entering audio-device setup.
It does not configure a driver, change `reaper.ini`, or copy a macOS audio
configuration. A machine without an audio device can still run OpenReaper
Bridge, project reads/writes, media processing, and offline renders. Real-time
playback and recording require an available audio device later.

## Known contained configuration-write dialog

During the Windows 11 / REAPER 7.78 contained alpha11 launch, REAPER showed
the user-reported dialog body:

`Configuration write error. Can't write to REAPER configuration file. App behavior may be unexpected.`

This was observed while launching the stock binary with the contained
`-cfgfile` path in interactive Session 2. The dialog blocked REAPER's startup
hook: the wrapper timed out with `startup_status=missing` while the REAPER
process remained alive. After the logged-in desktop user selected `OK`, the
normal REAPER window appeared, the startup hook reached
`bridge_dofile_succeeded`, and a matching heartbeat/public-read recovery run
passed. The evidence is retained under
`C:\OpenReaperLab\contained-alpha10\evidence-start-alpha11-r1`.

The paired English/Chinese path experiment, the contained directory ACL, and
direct PowerShell write checks did not reproduce a username or permissions
blocker. This is therefore a contained-fixture startup/configuration warning,
not evidence that OpenReaper needs a virtual sound card or a Unicode-path
workaround. Keep this handling development-only and user-mediated. The
packaged runtime must not click configuration, license, recovery, plugin-scan,
upgrade, or unknown REAPER dialogs automatically.

The follow-up diagnosis stopped the owned REAPER process `68492`, then started
the same contained package through the existing Session 2 native scheduled
task. The clean launch returned `startup-status=ready`, `bridge-status=ready`,
and `public-read-probe=passed` without reproducing the dialog. A second launch
probe with an already-running REAPER and no trusted OpenReaper PID record now
fails closed with the exact PID and executable path instead of starting a
competing instance. Treat the original warning as a transient duplicate or
residual-session configuration race until a fresh run proves otherwise.

The Windows PowerShell start entrypoint creates the explicitly selected
resource root and refuses an unmanaged `reaper.exe` process before mutation.
This guard is a startup safety measure, not a dialog auto-dismiss rule. The
user's normal REAPER process is never terminated by this path; close it and
retry through OpenReaper when the guard reports it.

## Known project recovery warning

The Windows 11 / REAPER 7.78 fixture can also show this recovery decision
after a previous project load failed:

- window title: `REAPER - Previously failed while loading project`
- top-level class: `#32770`
- body marker: `This project failed the last time a load was attempted` followed
  by the exact failed `.RPP` path and `Would you like to load it anyway?`
- observed button AutomationIds: `6` and `7`

This is a recovery/decision dialog, not the bounded missing-file or project
extension warning. The Windows UI inventory retained under
`C:\\OpenReaperLab\\windows-s5-r26-candidate\\evidence\\ui-probe-current-r2.json`
observed it for the failed S3 fixture project. Because choosing to load the
failed project changes the experiment state, development and packaged startup
must keep this dialog user-mediated and fail-closed. Do not add a generic
click fallback or infer the button from a localized label. The user should
choose the no-load option, then the managed start may continue.

## Known Project Load Warning

The Windows 11 / REAPER 7.78 fixture project can show this exact development
warning when it contains AU/SWS state that is unavailable on Windows:

- window title: `Project Load Warning`
- top-level class: `#32770`
- button: `OK`, class `Button`, `AutomationId=1`
- body markers: `There were 1 elements in the project that were saved by
  extensions.`, `AU: Pro-Q 3 (FabFilter)`, `AU: Pro-C 2 (FabFilter)`,
  `AU: Pro-L 2 (FabFilter)`, and `Project tokens not recognized:
  SWSAUTOCOLOR`

The exact observed body also reported one hundred eighty-one offline file
locations. This is a fixture warning, not evidence of a Chinese-path or
audio-device problem. The development-only helper
`scripts/windows/dismiss-known-reaper-project-load-warning.ps1` matches the
process, session, title, class, body markers, and button before sending one
bounded `OK` command, then verifies that the exact dialog is gone. The fresh
Windows evidence is retained at
`C:\OpenReaperLab\windows-s5-r26-candidate\evidence\project-warning-dismiss-r1.json`.

This helper is not a shipped runtime behavior. The packaged product remains
user-mediated/fail-closed for this warning and for all license, plugin-scan,
recovery, upgrade, and unknown decision dialogs. Do not save the fixture after
accepting the warning unless the test explicitly covers extension-state loss.

## Reusable procedure

1. Confirm the REAPER PID and its interactive desktop session. The current
   Windows acceptance host uses session `2`.
2. Copy the unbundled helper
   `scripts/windows/dismiss-known-reaper-audio-device-dialog.ps1` into the
   bounded lab root on Windows.
3. Run it through a temporary Windows-native interactive scheduled task with a
   short `-File` action. Pass the exact REAPER PID, session, and evidence path.
4. The helper uses UI Automation only to find one top-level `REAPER/#32770`
   window whose normalized body matches the exact prompt and whose `Button`
   `AutomationId` is `7`. It fails closed for zero or multiple matches.
5. Retain the JSON evidence, unregister the temporary task, and remove only
   the copied helper. Record a before/after manifest for the task, helper, and
   evidence paths.

The Windows 11 x64 / REAPER 7.78 acceptance host was also used to probe the
development click path. The exact element was found, but this REAPER dialog
reported no supported UIA patterns and did not close when the helper tried
`InvokePattern`, legacy pattern lookup, `BM_CLICK`, `WM_COMMAND`, exact-button
mouse/key messages, `AppActivate` + `Alt+N`, or `WM_CLOSE`. Each attempt was
checked by readback and recorded `outcome=not_closed`; a scheduled-task exit
code of zero is not sufficient evidence. On this host, ask the logged-in
desktop user to click `No(N)` once, then rerun the read-only probe. Do not add
more generic click fallbacks.

Do not use coordinate clicks, broad title matching, keyboard shortcuts, or a
generic "click through dialogs" loop. If the title, class, body, button class,
or AutomationId differs, stop and inspect the new window manually.

## User-agent handoff

The user-facing agent should identify this prompt by its exact title/class/body
and tell the user to choose `No` when no audio device is available. It should
not ask the user to install a virtual sound card for OpenReaper file workflows.
It must keep license, evaluation, plugin scan, recovery, upgrade, and unknown
decision windows user-mediated and fail-closed.

Observed Windows acceptance evidence is retained under the candidate's fresh
evidence root. This record is intentionally separate from the packaged
startup-dialog consent allowlist.
