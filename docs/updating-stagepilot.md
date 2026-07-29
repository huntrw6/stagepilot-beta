# Updating StagePilot

StagePilot checks for updates from the latest GitHub Release after the desktop
dashboard is ready. It waits about five seconds so the check never blocks
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
