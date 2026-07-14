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

$env:STAGEPILOT_PROPRESENTER_ENABLED = "true"
$env:STAGEPILOT_PROPRESENTER_HOST = $ProPresenterHost
$env:STAGEPILOT_PROPRESENTER_PORT = $ProPresenterPort.ToString()
$env:STAGEPILOT_PROPRESENTER_TIMER_NAME = $TimerName
$env:STAGEPILOT_PROPRESENTER_TIMEOUT_SECONDS = "3"

Write-Host "Starting StagePilot with the demo plan and real MIDI/ProPresenter..." -ForegroundColor Cyan
Write-Host "MIDI input: $MidiInputName"
Write-Host "ProPresenter: ${ProPresenterHost}:$ProPresenterPort"
Write-Host "Timer: $TimerName"

Push-Location $RepoRoot
try {
    uv run --project backend stagepilot
}
finally {
    Pop-Location
}
