[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Version,

    [switch]$Yes
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$env:GIT_PAGER = "cat"
$env:PAGER = "cat"

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [string]$Label,
        [Parameter(Mandatory)]
        [scriptblock]$Command
    )

    Write-Host "`n==> $Label" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

function Require-Command {
    param([Parameter(Mandatory)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found. Install it and run the release command again."
    }
}

function Invoke-NpmPackage {
    param(
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    Push-Location (Join-Path $Root $Directory)
    try {
        & npm @Arguments
    }
    finally {
        Pop-Location
    }
}

foreach ($command in @("git", "gh", "node", "npm", "uv", "cargo")) {
    Require-Command $command
}

if ((git rev-parse --show-toplevel) -ne $Root.Replace("\", "/") -and
    (git rev-parse --show-toplevel) -ne $Root) {
    throw "Run this command from the StagePilot repository."
}

if (-not $Version) {
    $Version = Read-Host "New StagePilot version (for example 1.1.43)"
}
$Version = $Version.Trim().TrimStart("v")
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw "Version '$Version' is not a valid semantic version."
}

$Tag = "v$Version"
$Branch = (git branch --show-current).Trim()
if (-not $Branch) {
    throw "Releases cannot be created from a detached HEAD."
}
if (git tag --list $Tag) {
    throw "Local tag $Tag already exists."
}
if (git ls-remote --exit-code --tags origin "refs/tags/$Tag" 2>$null) {
    throw "Remote tag $Tag already exists."
}

Invoke-Checked "Verify GitHub authentication" { gh auth status }
Invoke-Checked "Update all StagePilot version sources" {
    node scripts/set-release-version.mjs $Version
}
Invoke-Checked "Refresh the Python lockfile" { uv lock --project backend }
Invoke-Checked "Refresh the frontend lockfile" {
    Invoke-NpmPackage "frontend" @("install", "--package-lock-only", "--ignore-scripts")
}
Invoke-Checked "Refresh the desktop lockfile" {
    Invoke-NpmPackage "desktop" @("install", "--package-lock-only", "--ignore-scripts")
}
Invoke-Checked "Validate version and updater configuration" {
    node scripts/validate_versions.mjs $Tag
}

Invoke-Checked "Install locked backend dependencies" {
    uv sync --project backend --extra dev --locked
}
Invoke-Checked "Format backend source" {
    uv run --project backend ruff format backend/src backend/tests
}
Invoke-Checked "Verify backend formatting" {
    uv run --project backend ruff format --check backend/src backend/tests
}
Invoke-Checked "Backend lint" {
    uv run --project backend ruff check backend/src backend/tests
}
Invoke-Checked "Backend typecheck" {
    uv run --project backend python -m mypy --config-file backend/pyproject.toml backend/src backend/tests
}
Invoke-Checked "Backend tests" {
    uv run --project backend python -m pytest -c backend/pyproject.toml backend/tests
}

Invoke-Checked "Install locked frontend dependencies" {
    Invoke-NpmPackage "frontend" @("ci")
}
Invoke-Checked "Frontend lint" {
    Invoke-NpmPackage "frontend" @("run", "lint")
}
Invoke-Checked "Frontend typecheck" {
    Invoke-NpmPackage "frontend" @("run", "typecheck")
}
Invoke-Checked "Frontend tests" {
    Invoke-NpmPackage "frontend" @("test", "--", "--run")
}
Invoke-Checked "Frontend production build" {
    Invoke-NpmPackage "frontend" @("run", "build")
}

Invoke-Checked "Install locked desktop dependencies" {
    Invoke-NpmPackage "desktop" @("ci")
}
Invoke-Checked "Build packaged backend sidecar" {
    Invoke-NpmPackage "desktop" @("run", "build:sidecar")
}
Invoke-Checked "Format Rust source" {
    cargo fmt --manifest-path desktop/src-tauri/Cargo.toml
}
Invoke-Checked "Verify Rust formatting" {
    cargo fmt --manifest-path desktop/src-tauri/Cargo.toml --check
}
Invoke-Checked "Rust lint" {
    cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
}
Invoke-Checked "Rust tests" {
    cargo test --manifest-path desktop/src-tauri/Cargo.toml
}
Invoke-Checked "Desktop release configuration tests" {
    Invoke-NpmPackage "desktop" @("run", "release:test")
}

if (Test-Path "tools/multitracks-cues/package.json") {
    Invoke-Checked "Install locked MultiTracks CLI dependencies" {
        Invoke-NpmPackage "tools/multitracks-cues" @("ci")
    }
    Invoke-Checked "MultiTracks CLI typecheck" {
        Invoke-NpmPackage "tools/multitracks-cues" @("run", "typecheck")
    }
    Invoke-Checked "MultiTracks CLI tests" {
        Invoke-NpmPackage "tools/multitracks-cues" @("test", "--", "--run")
    }
    Invoke-Checked "MultiTracks CLI lint" {
        Invoke-NpmPackage "tools/multitracks-cues" @("run", "lint")
    }
    Invoke-Checked "MultiTracks CLI build" {
        Invoke-NpmPackage "tools/multitracks-cues" @("run", "build")
    }
}

Invoke-Checked "Check the release diff" { git --no-pager diff --check }

Write-Host "`nFiles that will be included:" -ForegroundColor Yellow
git status --short

if (-not $Yes) {
    $confirmation = Read-Host "Type RELEASE $Tag to commit, push, tag, and publish"
    if ($confirmation -ne "RELEASE $Tag") {
        throw "Release cancelled. No commit, tag, or push was created."
    }
}

Invoke-Checked "Stage all source changes" { git add --all }

$forbidden = git diff --cached --name-only |
    Where-Object { $_ -match '(^|/)(node_modules|dist|target|build|graphify-out|\.codex)(/|$)' -or $_ -match '\.(key|pem)$' }
if ($forbidden) {
    git reset
    throw "Release refused because generated or sensitive files were staged:`n$($forbidden -join "`n")"
}
if (-not (git diff --cached --name-only)) {
    throw "There are no changes to release."
}
Invoke-Checked "Check the staged release diff" { git --no-pager diff --cached --check }

Invoke-Checked "Commit StagePilot $Tag" {
    git commit -m "Release StagePilot $Tag" -m "Include the validated backend, frontend, desktop, documentation, and tooling changes."
}
Invoke-Checked "Push branch $Branch" { git push -u origin $Branch }
Invoke-Checked "Create release tag $Tag" { git tag -a $Tag -m "StagePilot $Tag" }
Invoke-Checked "Push release tag $Tag" { git push origin $Tag }

Write-Host "`nWaiting for the GitHub release workflow..." -ForegroundColor Cyan
$RunId = $null
for ($attempt = 0; $attempt -lt 12 -and -not $RunId; $attempt += 1) {
    Start-Sleep -Seconds 5
    $RunId = gh run list --repo huntrw6/stagepilot --workflow release-macos.yml --event push --branch $Tag --limit 1 --json databaseId --jq '.[0].databaseId'
}
if (-not $RunId) {
    throw "The tag was pushed, but the GitHub release workflow was not found. Check GitHub Actions manually."
}

Invoke-Checked "Build and publish StagePilot $Tag on GitHub" {
    gh run watch $RunId --repo huntrw6/stagepilot --interval 15 --exit-status
}

$ReleaseUrl = gh release view $Tag --repo huntrw6/stagepilot --json url --jq '.url'
Write-Host "`nStagePilot $Tag is published:" -ForegroundColor Green
Write-Host $ReleaseUrl
