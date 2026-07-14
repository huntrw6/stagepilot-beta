param(
    [string]$MidiInputName = "StagePilot MIDI",
    [string]$ProPresenterHost = "127.0.0.1",
    [int]$ProPresenterPort = 1025,
    [string]$TimerName = "Song Countdown"
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$env:STAGEPILOT_DEMO_MODE = "true"
$env:STAGEPILOT_DEMO_SIMULATE_MIDI = "false"
$env:STAGEPILOT_DEMO_SIMULATE_PROPRESENTER = "false"

$env:STAGEPILOT_MIDI_ENABLED = "true"
$env:STAGEPILOT_MIDI_INPUT_NAME = $MidiInputName
$env:STAGEPILOT_MIDI_CHANNEL = "1"
$env:STAGEPILOT_MIDI_NOTE = "112"
$env:STAGEPILOT_MIDI_START_NEXT_VELOCITY = "100"
$env:STAGEPILOT_MIDI_RESTART_CURRENT_VELOCITY = "101"
$env:STAGEPILOT_MIDI_PREVIOUS_VELOCITY = "102"
$env:STAGEPILOT_MIDI_NEXT_VELOCITY = "103"
$env:STAGEPILOT_MIDI_RELOAD_PLAN_VELOCITY = "104"
$env:STAGEPILOT_MIDI_STOP_TIMER_VELOCITY = "105"

# Remove the obsolete per-action note variables from this PowerShell process so
# an older test setup cannot override or confuse the fixed-note configuration.
@(
    "STAGEPILOT_MIDI_START_NEXT_NOTE",
    "STAGEPILOT_MIDI_RESTART_CURRENT_NOTE",
    "STAGEPILOT_MIDI_PREVIOUS_NOTE",
    "STAGEPILOT_MIDI_NEXT_NOTE",
    "STAGEPILOT_MIDI_RELOAD_PLAN_NOTE",
    "STAGEPILOT_MIDI_STOP_TIMER_NOTE"
) | ForEach-Object {
    Remove-Item "Env:$_" -ErrorAction SilentlyContinue
}

$env:STAGEPILOT_PROPRESENTER_ENABLED = "true"
$env:STAGEPILOT_PROPRESENTER_HOST = $ProPresenterHost
$env:STAGEPILOT_PROPRESENTER_PORT = $ProPresenterPort.ToString()
$env:STAGEPILOT_PROPRESENTER_TIMER_NAME = $TimerName
$env:STAGEPILOT_PROPRESENTER_TIMEOUT_SECONDS = "3"

Write-Host "Starting StagePilot with demo plan + real MIDI + real ProPresenter..." -ForegroundColor Cyan
Write-Host "MIDI input: $MidiInputName"
Write-Host "MIDI rule: channel 1, E7/note 112, velocities 100-105"
Write-Host "ProPresenter: ${ProPresenterHost}:$ProPresenterPort"
Write-Host "Timer: $TimerName"

Push-Location $RepoRoot
try {
    uv run --project backend stagepilot
}
finally {
    Pop-Location
}
