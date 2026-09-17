# Updating StagePilot

> **Private beta 1.1.103-beta.6: in-app update is off.** The release broker is
> not deployed for the beta by operator decision, so an installed beta build's
> update check finds no endpoint and no Update button appears. Beta testers get
> a newer build by downloading the installer from the new GitHub Release. The
> mechanism described below is fully implemented, CI-tested, and promotable —
> it simply has nothing to talk to during the beta. See
> [`native-completion-runbook.md`](native-completion-runbook.md).

StagePilot checks for updates after the desktop dashboard is ready. Main builds
use the public main GitHub Release endpoint; private-beta release builds point
at the beta control-plane metadata/download broker because private GitHub
Releases are not anonymously readable. The broker never disables or replaces
Tauri signature verification and does not relay Remote traffic. StagePilot waits about five seconds so the check never blocks
startup, checks again every six hours, and may check when the app regains focus
after that interval.

This runs only inside a production Tauri desktop build. The browser dashboard,
Vite previews, automated tests, and ordinary development builds do not contact
GitHub. A Tauri development build can opt in with
`VITE_STAGEPILOT_ENABLE_UPDATER=true`.

When the installed version is current—or GitHub cannot be reached—nothing is
shown in the header. When a newer signed release exists, a compact **Update**
button appears immediately to the right of the StagePilot logo. Pressing it
opens a confirmation dialog containing the current version, available version,
and plain-text release notes. No download begins until **Update and Restart** is
pressed.

After confirmation StagePilot records an update marker and safe route, saves
the window state, downloads the platform updater, lets Tauri verify its
signature and install it, and restarts automatically. The relaunch restores,
unminimizes, shows, and focuses the main window. A version-bound marker causes
`StagePilot updated to VERSION` to appear only after a successful update.

If download, signature verification, or installation fails, the installed
version remains open. The dialog offers **Retry** and **Close**. A failed
background check does not make the dashboard unhealthy or show a modal.

## Recovery

If a release is broken, mark it non-latest or delete its GitHub Release and
remove/replace the bad `latest.json`. Fix the defect and publish a **newer
version number**; never reuse a published version. If in-app recovery is not
possible, install a newer release manually. macOS may require Privacy &
Security approval again for that browser-downloaded replacement.

For the private beta, first move `BETA_LATEST_RELEASE_VERSION` back to the last
known-good allowlisted version and redeploy/read back the Worker. Then publish a
higher signed version; never mutate or reuse a published tag. See
[the private beta plan](private-beta-release-and-acceptance.md).

Tauri updater signatures are not Apple code signatures. Their contents are
embedded in `latest.json` and allow installed StagePilot copies to authenticate
the downloaded updater payload. Removing Hardened Runtime from StagePilot's
ad-hoc macOS application signature does not weaken or disable updater
verification. See [macOS ad-hoc signing](macos-adhoc-signing.md).
