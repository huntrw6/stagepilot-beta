# Desktop packaging and backend supervision

StagePilot's release build is a self-contained Windows desktop application. It
bundles the React dashboard, Tauri shell, and a PyInstaller-frozen Python
backend. End users do not need Python, uv, Node.js, Rust, or PowerShell.

## Build the installer

The build computer needs the normal repository prerequisites: Python 3.12, uv,
Node.js, npm, Rust, and the Tauri Windows prerequisites.

```powershell
npm ci --prefix frontend
npm ci --prefix desktop
npm --prefix desktop run build
```

The desktop build performs these steps:

1. Resolve the locked `packaging` dependency group in an isolated uv environment.
2. Freeze `stagepilot.__main__` into a one-file backend executable.
3. Rename and stage the executable using Tauri's Rust target-triple convention.
4. Build the frontend production assets.
5. Compile the Tauri application and create an NSIS installer.

The installer is written below
`desktop/src-tauri/target/release/bundle/nsis/`. Generated backend executables,
PyInstaller work files, and installer outputs are intentionally ignored by Git.

## Runtime lifecycle

On launch, the desktop shell reads the saved `server_port` from StagePilot's
ordinary settings file. An explicit `STAGEPILOT_PORT` environment override still
takes priority for development and diagnostics.

The shell then:

1. Probes the configured loopback port.
2. Reuses an existing StagePilot backend without claiming ownership of it.
3. Reports a clear failure if another application owns the port.
4. Starts the packaged backend when the port is available.
5. Polls `/api/v1/health` for up to 30 seconds.
6. Publishes supervisor status to the connecting screen.
7. Terminates the complete owned PyInstaller process tree when StagePilot exits.

The backend remains loopback-only. The frontend receives only a narrow custom
status command; it does not receive general shell or file-system permissions.

## Release smoke test

Test every installer candidate on a Windows account without repository tooling:

1. Install and launch StagePilot from the Start menu.
2. Confirm no terminal window appears and the dashboard connects automatically.
3. Complete first-launch configuration and close StagePilot.
4. Confirm no `stagepilot-backend.exe` process remains.
5. Launch again and confirm configuration and credentials persist.
6. Install the next version over the existing version and repeat the checks.
7. Uninstall StagePilot and confirm user settings remain available for an upgrade
   unless the release policy explicitly adds a separate data-removal option.

The application is not code-signed yet. Windows may display an unknown-publisher
warning until release signing is added during production hardening.
