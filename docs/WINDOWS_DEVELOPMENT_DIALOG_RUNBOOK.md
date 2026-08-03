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
