# Native lifecycle checks

The desktop locks through the same `Engine::lock` path used by the explicit
lock action and idle timeout. That path cancels active generation, note and
memory work, clears private conversations, closes the encrypted vault, and
rejects late writes.

## Implemented signals

Windows uses a hidden native window registered for current-session WTS
notifications. It locks on `WTS_SESSION_LOCK`, console disconnect, remote
disconnect, and `PBT_APMSUSPEND`. Microsoft documents the
[session-change message](https://learn.microsoft.com/windows/win32/termserv/wm-wtssession-change)
and [power-broadcast message](https://learn.microsoft.com/windows/win32/power/wm-powerbroadcast).

macOS observes the `NSWorkspace` notification center for session resign,
system sleep, and screen sleep. Apple documents
[`sessionDidResignActiveNotification`](https://developer.apple.com/documentation/appkit/nsworkspace/sessiondidresignactivenotification)
as a user session switching out. These documented notifications do not signal
an ordinary locked-but-awake screen, such as immediately after Control-Command-Q.
That case remains uncovered until a supported signal is selected and verified.

## Automated proof

The Windows-focused tests use callbacks and disposable synthetic vaults; they
do not lock, disconnect, or suspend the test machine.

- `platform_lock::windows_impl::tests::lock_and_disconnect_events_close_the_vault_boundary`
  checks the WTS lock, console-disconnect, and remote-disconnect mapping.
- `platform_lock::windows_impl::tests::monitor_can_restart_without_leaking_its_window_thread`
  starts and stops the native monitor twice, exercising subscription cleanup.
- `desktop::tests::native_security_event_locks_and_clears_private_state`
  verifies cancellation, vault closure, and private-session removal through
  the desktop event handler.

On Windows these focused tests and `cargo check --lib` passed on September 16,
2026. The macOS target remains gated by the pull-request build because this
Windows workspace cannot compile or execute AppKit code.

## Manual release matrix

Use a disposable synthetic vault and a local fixture response. Do not use a
personal vault or trigger these checks during unrelated work.

| Platform | Action | Expected result | Status |
| --- | --- | --- | --- |
| Windows | Lock the current session | Active work stops and the vault is locked before the session returns | Pending native check |
| Windows | Disconnect an RDP or console session | Active work stops and the vault is locked | Pending native check |
| Windows | Suspend and resume | Active work stops and the vault remains locked after resume | Pending native check |
| macOS | Switch to another user session | Active work stops and the vault is locked | Pending native check |
| macOS | Put the system or screens to sleep, then wake | Active work stops and the vault remains locked | Pending native check |
| macOS | Lock while the screen remains awake | No supported direct signal is implemented; do not treat this case as passing | Known release gap |

For each covered case, unlock the synthetic vault afterward and verify that a
streaming assistant message is interrupted, a private conversation is absent,
and a late callback cannot append content. Also verify that window titles and
notifications contain no conversation content.
