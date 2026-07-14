# ProPresenter countdown integration

StagePilot controls one reusable ProPresenter countdown timer through the local
HTTP API. Playback MIDI stays an input integration; it never calls
ProPresenter directly.

```text
Playback MIDI -> StagePilot action -> song.started -> ProPresenter timer
```

## ProPresenter setup

1. In **Show Controls > Timers**, create a countdown named `Song Countdown`.
2. Point the stage layout timer text at that timer.
3. In **ProPresenter Settings > Network**, enable the API and note its port.
4. Keep ProPresenter open while StagePilot starts. The plugin verifies that the
   configured countdown exists before it reports a connected state.

The exact timer endpoint schema is owned by the ProPresenter version installed
on the machine. Use the **API Documentation** button in ProPresenter's Network
settings when troubleshooting a version-specific response.

## Normal production configuration

```dotenv
STAGEPILOT_DEMO_MODE=false
STAGEPILOT_PROPRESENTER_ENABLED=true
STAGEPILOT_PROPRESENTER_HOST=127.0.0.1
STAGEPILOT_PROPRESENTER_PORT=1025
STAGEPILOT_PROPRESENTER_TIMER_NAME="Song Countdown"
STAGEPILOT_PROPRESENTER_TIMEOUT_SECONDS=3
```

When ProPresenter runs on another computer, replace `127.0.0.1` with that
computer's LAN address and allow the configured API port through its firewall.

## Mixed demo/hardware test

This is the easiest way to test the iPad-to-ProPresenter chain before Planning
Center credentials are configured. The values below are the settings used by
`scripts/run-demo-hardware.ps1` (StagePilot does not load `.env` implicitly):

```dotenv
STAGEPILOT_DEMO_MODE=true
STAGEPILOT_DEMO_SIMULATE_MIDI=false
STAGEPILOT_DEMO_SIMULATE_PROPRESENTER=false

STAGEPILOT_MIDI_ENABLED=true
STAGEPILOT_MIDI_INPUT_NAME="StagePilot MIDI"

STAGEPILOT_PROPRESENTER_ENABLED=true
STAGEPILOT_PROPRESENTER_HOST=127.0.0.1
STAGEPILOT_PROPRESENTER_PORT=1025
STAGEPILOT_PROPRESENTER_TIMER_NAME="Song Countdown"
```

The demo plugin still loads sample songs and durations, while the real MIDI and
ProPresenter plugins handle hardware I/O.

## Timer behavior

For `song.started` and `song.restarted`, the plugin performs:

1. Stop the configured timer.
2. Update its countdown duration while preserving its UUID and visible name.
3. Reset it.
4. Start it.
5. Publish `timer.started` so the dashboard reflects the result.

For `timer.stop_requested`, it stops the same timer and publishes
`timer.stopped`.

The timer is found by visible name and its identifier is cached. If an operation
fails because ProPresenter restarted or recreated the timer, StagePilot clears
the cache, rediscovers it once, and retries the operation.

## Default Playback notes

| Action | Note |
| --- | ---: |
| Start next song | 100 |
| Restart current song | 101 |
| Previous song | 102 |
| Next song without starting | 103 |
| Reload plan | 104 |
| Stop timer | 105 |

All note mappings remain configurable through environment variables.
