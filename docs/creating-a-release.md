# Creating a StagePilot release

From the repository root in PowerShell, run:

```powershell
.\create-new-release.ps1
```

The command asks for the next version and then:

1. Updates every StagePilot application and lockfile version.
2. Refreshes the Python, frontend, and desktop lockfiles.
3. Runs backend, frontend, desktop/Rust, and MultiTracks CLI validation.
4. Shows every file that will be included.
5. Requires the typed confirmation `RELEASE vX.Y.Z`.
6. Commits and pushes all intended changes.
7. Creates and pushes the version tag.
8. Waits for GitHub to build the Intel Mac, Apple Silicon Mac, and Windows packages.
9. Prints the published GitHub release URL.

You may supply the version directly:

```powershell
.\create-new-release.ps1 1.1.43
```

For an unattended invocation after reviewing the working tree, add `-Yes`:

```powershell
.\create-new-release.ps1 1.1.43 -Yes
```

The release stops immediately if a test fails, the tag already exists, GitHub
authentication is unavailable, or generated/sensitive files are staged. A
failure before the confirmation creates no commit, tag, or push.
