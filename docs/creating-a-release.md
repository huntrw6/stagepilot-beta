# Creating a StagePilot release

From the repository root in PowerShell, run:

```powershell
.\create-new-release.ps1
```

The command asks for the next version and release destination. The destination
defaults to `main`; another branch may be selected when needed. It then:

1. Shows the release title, source branch, destination branch, and current changes.
2. Requires one typed confirmation such as `RELEASE v1.1.44 TO main`.
3. Updates every StagePilot application and lockfile version.
4. Refreshes the Python, frontend, and desktop lockfiles.
5. Runs backend, frontend, desktop/Rust, and MultiTracks CLI validation.
6. Displays the release diff without opening an interactive pager.
7. Commits and pushes all intended changes to the confirmed destination.
8. Creates and pushes the version tag.
9. Waits for GitHub to build the Intel Mac, Apple Silicon Mac, and Windows packages.
10. Prints the published GitHub release URL.

After the release plan is confirmed, no further input is required.

You may supply the version directly:

```powershell
.\create-new-release.ps1 1.1.43
```

For an unattended invocation after reviewing the working tree, add `-Yes`:

```powershell
.\create-new-release.ps1 1.1.43 -Yes
```

`-Yes` uses `main` by default. To publish the release commit to another branch:

```powershell
.\create-new-release.ps1 1.1.43 -TargetBranch release/test -Yes
```

The release stops immediately if a test fails, the tag already exists, GitHub
authentication is unavailable, the current checkout is behind `origin/main`,
or generated/sensitive files are staged. A failure before confirmation makes
no changes; a later validation failure leaves changes local without committing,
tagging, or pushing.
